//! Rewrite the `@param` tags of a script, the values of its inputs: `@param :name = <literal>`, the literal in the
//! Hyper dialect (`sql_literal`).
//!
//! The value of an input is a tag of any statement: the first `@param` tag of the name in statement order is replaced
//! where it is, the other tags of the name are removed. Without a tag, a new one goes into the annotation of the
//! statement that uses the input first, before its `@vis` tags. Removing the value removes every tag of the name.

use crate::analyzer::param_tags::{split_param_tag, PARAM_TAG};
use crate::annotation::{Annotation, AnnotationTag};
use crate::error::{Error, Result};
use crate::sql_literal::SqlLiteral;
use dashql_buffers::status::StatusCode;
use dashql_parser::parser::ParsedScript;

/// Is a tag the `@param` tag of a name?
fn is_input(tag: &AnnotationTag, name: &str) -> bool {
    tag.name == PARAM_TAG && split_param_tag(&tag.text()).is_ok_and(|parts| parts.name == name)
}

/// The parameter as written in a tag, `:min`, double-quoted if it is no plain word, `:"foo 2"`
fn tag_name(name: &str) -> String {
    if !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        format!(":{name}")
    } else {
        format!(":\"{}\"", name.replace('"', ""))
    }
}

/// The `@param` tag of a value
pub fn param_tag(name: &str, literal: &SqlLiteral) -> AnnotationTag {
    AnnotationTag::new(PARAM_TAG, vec![format!("{} = {}", tag_name(name), literal.to_hyper())])
}

/// Set or remove the value of an input, a literal in the Hyper dialect. `first_use` is the statement that uses the
/// input first, a new tag goes there, the last statement if unknown.
pub fn rewrite_param_tag(text: &str, parsed: &ParsedScript, name: &str, literal: Option<&str>, first_use: Option<usize>) -> Result<String> {
    let literal = literal.map(SqlLiteral::parse).transpose().map_err(Error::invalid_argument)?;
    let value = literal.as_ref();
    if !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    let mut tagged = Vec::new();
    for statement_id in 0..parsed.statements.len() {
        if crate::annotation::read_annotation(parsed, statement_id)?.tags.iter().any(|t| is_input(t, name)) {
            tagged.push(statement_id);
        }
    }
    let last = parsed.statements.len().checked_sub(1);
    let target = match (tagged.first(), value) {
        (Some(&first), _) => first,
        (None, None) => return Ok(text.to_string()),
        (None, Some(_)) => first_use.filter(|&s| s < parsed.statements.len()).or(last).ok_or_else(|| Error::invalid_argument("the script has no statement"))?,
    };
    let mut statements = tagged;
    if !statements.contains(&target) {
        statements.push(target);
    }
    // Back to front, an edit leaves the spans of the statements before it alone
    statements.sort_unstable();
    let mut text = text.to_string();
    for &statement_id in statements.iter().rev() {
        let write = if statement_id == target { value } else { None };
        text = crate::annotation::rewrite(&text, parsed, statement_id, |annotation: &mut Annotation| {
            let tags = &mut annotation.tags;
            let first = tags.iter().position(|t| is_input(t, name));
            tags.retain(|t| !is_input(t, name));
            Ok(write.map(|literal| {
                let i = first
                    .unwrap_or_else(|| {
                        // After the other inputs, before the visualization
                        tags.iter()
                            .rposition(|t| t.name == PARAM_TAG)
                            .map(|i| i + 1)
                            .or_else(|| tags.iter().position(|t| matches!(t.name.as_str(), "vis" | "board" | "flow")))
                            .unwrap_or(tags.len())
                    })
                    .min(tags.len());
                tags.insert(i, param_tag(name, literal));
                i
            }))
        })?
        .0;
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::rewrite_param_tag;
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;

    fn rewrite(text: &str, name: &str, value: Option<&str>, first_use: Option<usize>) -> String {
        let parsed = parse(std::sync::Arc::new(scan(text, 0, 0)));
        rewrite_param_tag(text, &parsed, name, value, first_use).unwrap()
    }

    #[test]
    fn adds_a_tag_to_the_first_use() {
        assert_eq!(rewrite("select 1;\nselect :min", "min", Some("10"), Some(1)), "select 1;\n/** @param :min = 10 */\nselect :min");
        assert_eq!(rewrite("select :span", "span", Some("INTERVAL '3' DAY"), None), "/** @param :span = interval '3' day */\nselect :span");
    }

    #[test]
    fn replaces_the_tag_in_place() {
        assert_eq!(rewrite("/* @param :min = 10 */\nselect :min", "min", Some("20"), None), "/** @param :min = 20 */\nselect :min");
        assert_eq!(
            rewrite("/** @param :a = 1\n * @param :min = 10\n * @vis table */\nselect :min", "min", Some("'x y'"), None),
            "/**\n * @param :a = 1\n * @param :min = 'x y'\n * @vis table\n */\nselect :min"
        );
        // An unset input gets its value
        assert_eq!(rewrite("/* @param :min */\nselect :min", "min", Some("1"), None), "/** @param :min = 1 */\nselect :min");
    }

    #[test]
    fn adds_before_the_visualization() {
        assert_eq!(
            rewrite("/* @vis table */\nselect :min", "min", Some("3"), Some(0)),
            "/**\n * @param :min = 3\n * @vis table\n */\nselect :min"
        );
    }

    #[test]
    fn removes_duplicates_and_values() {
        assert_eq!(
            rewrite("/* @param :min = 1 */\nselect 1;\n/* @param :min = 2 */\nselect :min", "min", Some("3"), Some(1)),
            "/** @param :min = 3 */\nselect 1;\nselect :min"
        );
        assert_eq!(rewrite("/* @param :min = 1 */\nselect :min", "min", None, None), "select :min");
        assert_eq!(rewrite("select :min", "min", None, None), "select :min");
    }

    #[test]
    fn quotes_names_and_rejects_expressions() {
        assert_eq!(rewrite("select :\"foo 2\"", "foo 2", Some("'a'"), None), "/** @param :\"foo 2\" = 'a' */\nselect :\"foo 2\"");
        let parsed = parse(std::sync::Arc::new(scan("select :min", 0, 0)));
        assert!(rewrite_param_tag("select :min", &parsed, "min", Some("1 + 1"), None).is_err());
    }
}
