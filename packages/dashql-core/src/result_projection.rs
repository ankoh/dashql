//! Project the columns of the result of a script: wrap its terminal query, the last statement, into a common table
//! expression and select every column of its result below it, `with base as (<query>) select a, b from base`. A column
//! is excluded by deleting its line. The new statement is formatted with the pretty printer, the rest of the script
//! stays as written.

use crate::error::{Error, Result};
use crate::formatter::Formatter;
use crate::utils::quote_column_name;
use dashql_buffers::formatting::FormattingConfigT;
use dashql_buffers::parser::StatementType;
use dashql_parser::parser::{parse, ParsedScript};
use dashql_parser::scanner::scan;
use std::collections::HashSet;
use std::sync::Arc;

/// The name of the common table expression that holds the query of the script
const PROJECTION_INPUT: &str = "base";

/// The script does not parse or has no statement
pub const NOT_PARSED: &str = "The script does not parse";
/// The last statement of the script is no query
pub const NO_QUERY: &str = "The last statement is no query";
/// The result has no columns
pub const NO_COLUMNS: &str = "The result has no columns";
/// Two columns of the result have the same name, a projection cannot tell them apart
pub const DUPLICATE_COLUMNS: &str = "Two columns have the same name";

/// Select the columns of the result of the terminal query of a script below it. `parsed` is the parsed `text`, its
/// spans count UTF-8 bytes. Returns the new text of the script, or an error whose message says why the script cannot
/// get the projection.
pub fn rewrite_result_projection(
    text: &str,
    parsed: &ParsedScript,
    columns: &[String],
    config: &FormattingConfigT,
) -> Result<String> {
    if columns.is_empty() {
        return Err(Error::invalid_argument(NO_COLUMNS));
    }
    let mut names = HashSet::new();
    if !columns.iter().all(|name| names.insert(name.as_str())) {
        return Err(Error::invalid_argument(DUPLICATE_COLUMNS));
    }
    if !parsed.scanned.errors.is_empty() || !parsed.errors.is_empty() {
        return Err(Error::invalid_argument(NOT_PARSED));
    }
    let Some(statement) = parsed.statements.last() else {
        return Err(Error::invalid_argument(NOT_PARSED));
    };
    if statement.statement_type != StatementType::SELECT {
        return Err(Error::invalid_argument(NO_QUERY));
    }
    let Some(span) = parsed.associate_descriptions().last().map(|description| description.statement_span) else {
        return Err(Error::invalid_argument(NOT_PARSED));
    };
    let start = span.offset as usize;
    let end = start + span.length as usize;
    let (Some(before), Some(query), Some(after)) = (text.get(..start), text.get(start..end), text.get(end..)) else {
        return Err(Error::invalid_argument(NOT_PARSED));
    };

    let input = quote_column_name(PROJECTION_INPUT);
    let columns: Vec<String> = columns.iter().map(|name| quote_column_name(name)).collect();
    let projection = format!("with {input} as ({query}) select {} from {input};", columns.join(", "));
    // The separator of the statement stays in the text after it
    let formatted = format_statement(&projection, config).unwrap_or_else(|| layout_projection(&input, query, &columns));
    Ok(format!("{before}{formatted}{after}"))
}

/// The formatted statement without its separator, None if the formatter cannot format all of it
fn format_statement(text: &str, config: &FormattingConfigT) -> Option<String> {
    let parsed = parse(Arc::new(scan(text, 0, 0)));
    if !parsed.scanned.errors.is_empty() || !parsed.errors.is_empty() {
        return None;
    }
    let mut formatter = Formatter::new(&parsed);
    let formatted = formatter.format(config);
    if !formatter.is_fully_formatted() {
        return None;
    }
    let formatted = formatted.trim_end();
    Some(formatted.strip_suffix(';').unwrap_or(formatted).to_string())
}

/// The projection when the formatter cannot format the query, the query keeps its text
fn layout_projection(input: &str, query: &str, columns: &[String]) -> String {
    format!(
        "with {input} as (\n    {}\n)\nselect\n    {}\nfrom {input}",
        query.split('\n').collect::<Vec<_>>().join("\n    "),
        columns.join(",\n    ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use dashql_buffers::formatting::{FormattingDialect, FormattingMode, KeywordCase};

    fn pretty() -> FormattingConfigT {
        let mut config = FormattingConfigT::default();
        config.dialect = FormattingDialect::HYPER;
        config.mode = FormattingMode::PRETTY;
        config.max_width = 80;
        config.indentation_width = 4;
        config.keyword_case = KeywordCase::LOWER;
        config
    }

    fn project(text: &str, columns: &[&str]) -> Result<String> {
        let parsed = parse(Arc::new(scan(text, 0, 0)));
        let columns: Vec<String> = columns.iter().map(|c| c.to_string()).collect();
        rewrite_result_projection(text, &parsed, &columns, &pretty())
    }

    fn message(result: Result<String>) -> String {
        result.err().map(|e| e.message).unwrap_or_default()
    }

    #[test]
    fn wraps_the_query_into_a_common_table_expression() {
        assert_eq!(
            project("select a, b from t;", &["a", "b"]).ok().as_deref(),
            Some("with base as (\n    select a, b\n    from t\n)\nselect a, b\nfrom base;")
        );
    }

    #[test]
    fn keeps_the_statements_and_comments_before_the_query() {
        let projected = project("create temp table t as select 1 as a;\n/* @vis table */\nselect * from t;\n", &["a"])
            .unwrap_or_default();
        assert!(
            projected.starts_with("create temp table t as select 1 as a;\n/* @vis table */\nwith base as ("),
            "{projected}"
        );
        assert!(projected.ends_with("from base;\n"), "{projected}");
    }

    #[test]
    fn quotes_column_names_that_do_not_read_back_unquoted() {
        let projected =
            project(r#"select 1 as "user", 2 as "Name", 3 as "a b""#, &["user", "Name", "a b"]).unwrap_or_default();
        assert!(projected.contains(r#""user""#), "{projected}");
        assert!(projected.contains(r#""Name""#), "{projected}");
        assert!(projected.contains(r#""a b""#), "{projected}");
        assert!(!projected.ends_with(';'), "{projected}");
    }

    #[test]
    fn keeps_non_ascii_text_around_the_query() {
        let projected = project("/* é */ select 'ü' as x;", &["x"]).unwrap_or_default();
        assert!(projected.starts_with("/* é */ with base as ("), "{projected}");
        assert!(projected.contains("'ü'"), "{projected}");
    }

    #[test]
    fn rejects_scripts_and_results_without_a_projection() {
        assert_eq!(message(project("select from", &["a"])), NOT_PARSED);
        assert_eq!(message(project("", &["a"])), NOT_PARSED);
        assert_eq!(message(project("select 1 as a; drop table t;", &["a"])), NO_QUERY);
        assert_eq!(message(project("select 1", &[])), NO_COLUMNS);
        assert_eq!(message(project("select 1 as a, 2 as a", &["a", "a"])), DUPLICATE_COLUMNS);
    }
}
