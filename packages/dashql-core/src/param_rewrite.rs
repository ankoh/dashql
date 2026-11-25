//! Rewrite the `@param` tags of a script, the values of its inputs: `@param :name = <literal>`, the literal in the
//! Hyper dialect (`sql_literal`).
//!
//! The value of an input is a tag of any statement: the first `@param` tag of the name in statement order is replaced
//! where it is, the other tags of the name are removed. Without a tag, a new one goes into the annotation of the
//! statement that uses the input first, before its `@vis` tags. Removing the value removes every tag of the name.
//!
//! `add_param` adds a new parameter at a selection of the script: a literal there becomes the parameter and its value,
//! otherwise the statement gets an unset tag.

use crate::analyzer::param_tags::{split_param_tag, PARAM_TAG};
use crate::annotation::{read_annotation, rewrite, rewrite_script_tag, AnnotationTag};
use crate::cursor::{find_node_at_offset, is_inside_comment};
use crate::error::{Error, Result};
use crate::sql_literal::SqlLiteral;
use crate::vis_rewrite::is_vis_family;
use dashql_buffers::parser::{AttributeKey as K, NodeType};
use dashql_buffers::status::StatusCode;
use dashql_parser::comment_blocks::COMMENT_TAG_PREFIX;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;
use std::collections::BTreeSet;
use std::ops::Range;

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
pub fn rewrite_param_tag(
    text: &str,
    parsed: &ParsedScript,
    name: &str,
    literal: Option<&str>,
    first_use: Option<usize>,
) -> Result<String> {
    let literal = literal.map(SqlLiteral::parse).transpose().map_err(Error::invalid_argument)?;
    let tag = literal.map(|literal| param_tag(name, &literal));
    rewrite_script_tag(text, parsed, |t| is_input(t, name), tag, first_use, insert_at)
}

/// Where a new `@param` tag goes among the tags of an annotation: after the other inputs, before the visualization
fn insert_at(tags: &[AnnotationTag]) -> usize {
    tags.iter()
        .rposition(|t| t.name == PARAM_TAG)
        .map(|i| i + 1)
        .or_else(|| tags.iter().position(is_vis_family))
        .unwrap_or(tags.len())
}

/// The name of a new parameter that nothing names better
const DEFAULT_PARAM_NAME: &str = "param";

/// A parameter that `add_param` added to a script
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddedParam {
    /// The text with the parameter
    pub text: String,
    /// The name of the parameter
    pub name: String,
    /// The name in the new text without its colon, in bytes: the parameter that took the place of the literal, the
    /// name in the tag without a literal
    pub name_range: Range<usize>,
}

/// A literal of a statement that becomes a parameter
struct LiteralAt {
    statement: usize,
    /// The bytes of the literal in the text
    range: Range<usize>,
    literal: SqlLiteral,
    /// The name that the place of the literal suggests
    name: Option<String>,
}

/// Is a name a plain word, written without quotes?
fn is_plain_word(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The name that the place of a literal suggests: `limit` and `offset` for the clauses, the column that an expression
/// compares the literal to, `amount` in `amount > 10` and `x in (1, 2)`
fn suggested_name(parsed: &ParsedScript, node: u32) -> Option<String> {
    let node = parsed.nodes.get(node as usize)?;
    match node.attribute_key() {
        K::SQL_SELECT_LIMIT => return Some("limit".into()),
        K::SQL_SELECT_OFFSET => return Some("offset".into()),
        _ => {}
    }
    let mut args = parsed.nodes.get(node.parent() as usize)?;
    // The list of `x in (1, 2)` is an argument of its own
    if args.node_type() == NodeType::ARRAY && args.attribute_key() != K::SQL_EXPRESSION_ARGS {
        args = parsed.nodes.get(args.parent() as usize)?;
    }
    if args.node_type() != NodeType::ARRAY || args.attribute_key() != K::SQL_EXPRESSION_ARGS {
        return None;
    }
    let column = parsed.children(args).iter().find(|c| c.node_type() == NodeType::OBJECT_SQL_COLUMN_REF)?;
    let path = parsed.children(column).iter().find(|c| c.attribute_key() == K::SQL_COLUMN_REF_PATH)?;
    let name = parsed.node_text(parsed.children(path).last()?);
    is_plain_word(name).then(|| name.to_string())
}

/// The literal around a selection: the largest node of a statement that holds the selection and whose text is a
/// literal, `interval '3' day` around `'3'`
fn literal_at(parsed: &ParsedScript, selection: &Range<usize>) -> Option<LiteralAt> {
    if is_inside_comment(&parsed.scanned, selection.start) {
        return None;
    }
    let (statement, mut node_id) = find_node_at_offset(parsed, selection.start)?;
    let scanned = &parsed.scanned;
    let mut found: Option<LiteralAt> = None;
    while let Some(node) = parsed.nodes.get(node_id as usize) {
        let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
        let range = span.offset as usize..span.end() as usize;
        // Statement roots are their own parents, a statement is no literal
        let parent = node.parent();
        if parent == node_id {
            break;
        }
        // A list of one literal is no literal of its own, `in (10)`
        if node.node_type() != NodeType::ARRAY && range.start <= selection.start && selection.end <= range.end {
            match SqlLiteral::parse(parsed.node_text(node)) {
                Ok(literal) => {
                    let name = suggested_name(parsed, node_id);
                    found = Some(LiteralAt { statement: statement as usize, range, literal, name });
                }
                // The literal ends where its parent is no literal
                Err(_) if found.is_some() => break,
                Err(_) => {}
            }
        }
        node_id = parent;
    }
    found
}

/// The names of the parameters that a script uses or tags
fn script_param_names(parsed: &ParsedScript) -> BTreeSet<String> {
    let unquote = |name: &str| name.trim_start_matches(':').trim_matches('"').to_string();
    let mut names: BTreeSet<String> = parsed
        .nodes
        .iter()
        .filter(|n| n.node_type() == NodeType::OBJECT_SQL_PARAMETER_REF)
        .map(|n| unquote(parsed.node_text(n)))
        .collect();
    for statement_id in 0..parsed.statements.len() {
        let Ok(annotation) = read_annotation(parsed, statement_id) else { continue };
        for tag in annotation.tags.iter().filter(|t| t.name == PARAM_TAG) {
            if let Ok(parts) = split_param_tag(&tag.text()) {
                names.insert(parts.name.to_string());
            }
        }
    }
    names
}

/// A name that is not taken: the base, then the base with a number, `param2`
fn unique_name(base: &str, taken: &BTreeSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_string();
    }
    (2..).map(|i| format!("{base}{i}")).find(|n| !taken.contains(n)).unwrap_or_else(|| base.to_string())
}

/// Add a new parameter at a selection of a script, its bytes. A literal around the selection (`10`, `'EU'`,
/// `date '2024-01-01'`, `interval '3' day`) becomes the parameter and its value: `amount > 10` becomes
/// `amount > :amount` with the tag `@param :amount = 10` on its statement. Without a literal the statement at the
/// selection gets an unset tag, `@param :param`. The name is the column that the literal is compared to, `limit` or
/// `offset` for these clauses, `param` otherwise, with a number if the script or `taken`, e.g. the inputs of the
/// other scripts of a workbook, have it already.
pub fn add_param(text: &str, parsed: &ParsedScript, selection: Range<usize>, taken: &[String]) -> Result<AddedParam> {
    if !parsed.errors.is_empty() {
        return Err(Error::status(StatusCode::SCRIPT_NOT_PARSED));
    }
    if parsed.statements.is_empty() {
        return Err(Error::invalid_argument("the script has no statement"));
    }
    // The selection without the whitespace around it
    let selected = text.get(selection.clone()).unwrap_or("");
    let start = selection.start + (selected.len() - selected.trim_start().len());
    let selection = start..start + selected.trim().len();
    let literal = literal_at(parsed, &selection);

    let mut names = script_param_names(parsed);
    names.extend(taken.iter().cloned());
    let base = literal.as_ref().and_then(|l| l.name.as_deref()).unwrap_or(DEFAULT_PARAM_NAME);
    let name = unique_name(base, &names);
    let tag = match &literal {
        Some(l) => param_tag(&name, &l.literal),
        None => AnnotationTag::new(PARAM_TAG, vec![tag_name(&name)]),
    };
    // The statement of the literal, the statement at the selection otherwise
    let statement = match &literal {
        Some(l) => l.statement,
        None => find_node_at_offset(parsed, selection.start).map_or(0, |(s, _)| s as usize),
    };
    let (tagged, span) = rewrite(text, parsed, statement, |annotation| {
        let i = insert_at(&annotation.tags);
        annotation.tags.insert(i, tag);
        Ok(Some(i))
    })?;
    let outdated = || Error::invalid_argument("the parsed script is outdated");
    // The name in the tag, after `@param :`
    let span = span.ok_or_else(outdated)?;
    let tag_name_start = span.offset as usize + format!("{COMMENT_TAG_PREFIX}{PARAM_TAG} :").len();
    if tagged.get(tag_name_start..tag_name_start + name.len()) != Some(name.as_str()) {
        return Err(outdated());
    }
    let Some(literal) = literal else {
        return Ok(AddedParam { text: tagged, name_range: tag_name_start..tag_name_start + name.len(), name });
    };
    // The annotation precedes the statement, the literal moved by the length that the annotation changed
    let shift = |offset: usize| (offset + tagged.len()).checked_sub(text.len());
    let (Some(begin), Some(end)) = (shift(literal.range.start), shift(literal.range.end)) else {
        return Err(outdated());
    };
    if tag_name_start >= begin || tagged.get(begin..end) != text.get(literal.range.clone()) {
        return Err(outdated());
    }
    let (Some(head), Some(tail)) = (tagged.get(..begin), tagged.get(end..)) else { return Err(outdated()) };
    let out = format!("{head}:{name}{tail}");
    Ok(AddedParam { text: out, name_range: begin + 1..begin + 1 + name.len(), name })
}

#[cfg(test)]
mod tests {
    use super::{add_param, rewrite_param_tag};
    use dashql_parser::parser::parse;
    use dashql_parser::scanner::scan;

    /// Add a parameter at the selection that `|` marks, `|10|` or `1|0`. Returns the text and the name in it.
    fn add(marked: &str, taken: &[&str]) -> (String, String) {
        let marks: Vec<usize> = marked.match_indices('|').map(|(i, _)| i).collect();
        let text = marked.replace('|', "");
        let selection = match marks[..] {
            [at] => at..at,
            [from, to] => from..to - 1,
            _ => panic!("one or two marks"),
        };
        let parsed = parse(std::sync::Arc::new(scan(&text, 0, 0)));
        let taken: Vec<String> = taken.iter().map(|t| t.to_string()).collect();
        let added = add_param(&text, &parsed, selection, &taken).unwrap();
        assert_eq!(&added.text[added.name_range.clone()], added.name);
        let named =
            format!("{}[{}]{}", &added.text[..added.name_range.start], added.name, &added.text[added.name_range.end..]);
        (named, added.name)
    }

    #[test]
    fn adds_the_literal_at_the_cursor_as_parameter() {
        // The name is the column that the literal is compared to
        assert_eq!(
            add("select * from orders where amount > 1|0", &[]).0,
            "/** @param :amount = 10 */\nselect * from orders where amount > :[amount]"
        );
        assert_eq!(
            add("select * from orders where o.region = |'EU'|", &[]).0,
            "/** @param :region = 'EU' */\nselect * from orders where o.region = :[region]"
        );
        // The literal is the whole typed literal around the cursor
        assert_eq!(
            add("select * from t where ts > now() - interval '|3' day", &[]).0,
            "/** @param :param = interval '3' day */\nselect * from t where ts > now() - :[param]"
        );
        assert_eq!(
            add("select * from t limit 10|", &[]).0,
            "/** @param :limit = 10 */\nselect * from t limit :[limit]"
        );
        // A cast stays in the query, the type of the input
        assert_eq!(
            add("select * from t where d = '2024-01-01|'::date", &[]).0,
            "/** @param :param = '2024-01-01' */\nselect * from t where d = :[param]::date"
        );
        assert_eq!(add("select 1 where x in (|10)", &[]).0, "/** @param :x = 10 */\nselect 1 where x in (:[x])");
    }

    #[test]
    fn adds_the_tag_to_the_statement_of_the_literal() {
        assert_eq!(
            add("/* @vis table */\nselect 1;\n/* @param :a = 1\n   @vis table */\nselect :a where b < |2", &[]).0,
            "/* @vis table */\nselect 1;\n/**\n * @param :a = 1\n * @param :b = 2\n * @vis table\n */\nselect :a where b < :[b]"
        );
    }

    #[test]
    fn takes_a_name_that_is_free() {
        // Names of the script, of its tags and of the workbook are taken
        assert_eq!(add("/* @param :amount2 */\nselect :amount where amount > |10", &["amount3"]).1, "amount4");
        assert_eq!(add("select |1", &["param", "param2"]).1, "param3");
    }

    #[test]
    fn adds_an_unset_tag_without_a_literal() {
        assert_eq!(add("select * from |orders", &[]).0, "/** @param :[param] */\nselect * from orders");
        assert_eq!(add("select 1;\nselect a| from t", &[]).0, "select 1;\n/** @param :[param] */\nselect a from t");
        // A literal in a comment is no literal of the query, the comment becomes the description of the annotation
        assert_eq!(add("-- 1|0\nselect 1", &["param"]).0, "/**\n * 10\n *\n * @param :[param2]\n */\nselect 1");
    }

    #[test]
    fn needs_a_parsed_statement() {
        let fails = |text: &str| {
            let parsed = parse(std::sync::Arc::new(scan(text, 0, 0)));
            add_param(text, &parsed, 0..0, &[]).is_err()
        };
        assert!(fails(""));
        assert!(fails("select from where"));
    }

    fn rewrite(text: &str, name: &str, value: Option<&str>, first_use: Option<usize>) -> String {
        let parsed = parse(std::sync::Arc::new(scan(text, 0, 0)));
        rewrite_param_tag(text, &parsed, name, value, first_use).unwrap()
    }

    #[test]
    fn adds_a_tag_to_the_first_use() {
        assert_eq!(
            rewrite("select 1;\nselect :min", "min", Some("10"), Some(1)),
            "select 1;\n/** @param :min = 10 */\nselect :min"
        );
        assert_eq!(
            rewrite("select :span", "span", Some("INTERVAL '3' DAY"), None),
            "/** @param :span = interval '3' day */\nselect :span"
        );
    }

    #[test]
    fn replaces_the_tag_in_place() {
        assert_eq!(
            rewrite("/* @param :min = 10 */\nselect :min", "min", Some("20"), None),
            "/** @param :min = 20 */\nselect :min"
        );
        assert_eq!(
            rewrite(
                "/** @param :a = 1\n * @param :min = 10\n * @vis table */\nselect :min",
                "min",
                Some("'x y'"),
                None
            ),
            "/**\n * @param :a = 1\n * @param :min = 'x y'\n * @vis table\n */\nselect :min"
        );
        // An unset input gets its value
        assert_eq!(
            rewrite("/* @param :min */\nselect :min", "min", Some("1"), None),
            "/** @param :min = 1 */\nselect :min"
        );
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
        assert_eq!(
            rewrite("select :\"foo 2\"", "foo 2", Some("'a'"), None),
            "/** @param :\"foo 2\" = 'a' */\nselect :\"foo 2\""
        );
        let parsed = parse(std::sync::Arc::new(scan("select :min", 0, 0)));
        assert!(rewrite_param_tag("select :min", &parsed, "min", Some("1 + 1"), None).is_err());
    }
}
