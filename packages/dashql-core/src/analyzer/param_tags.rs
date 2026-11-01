//! The values of the parameters of a script, from `@param` comment tags.
//!
//! ```sql
//! /* @param :min = 10
//!    @param :span = interval '3 days' */
//! select * from orders where amount > :min and ts > now() - :span;
//! ```
//!
//! A tag names a scalar parameter as it is written in the query and gives its value as a SQL literal in the Hyper
//! dialect (`sql_literal`), whatever the connection of the script speaks. A tag without a value, `@param :min`, leaves
//! the input unset. The tags hold the values of the script, like `@flow` they may annotate any statement, and the
//! first tag of a name in statement order wins. Problems are warnings with a span inside the comment, a tag whose
//! value is no literal leaves the input unset. A `@param` that names no `:parameter`, e.g. the `@param x the x` of a
//! Javadoc comment, is no value and stays quiet.

use super::state::AnalysisState;
use super::types::*;
use crate::sql_literal::SqlLiteral;
use crate::vis_text::TagText;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::CommentBlockType;
use dashql_parser::span::TextSpan;
use std::ops::Range;
use std::sync::Arc;

/// The tag of parameter values
pub const PARAM_TAG: &str = "param";

/// The parts of an `@param` tag: the name of the parameter, its range, and the range of the literal after `=`
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParamTagParts<'a> {
    pub name: &'a str,
    pub name_range: Range<usize>,
    /// The literal, None without `=`
    pub literal: Option<Range<usize>>,
}

/// Split an `@param :name = <literal>` tag. The name may be double-quoted, `:"foo 2"`.
pub fn split_param_tag(text: &str) -> Result<ParamTagParts<'_>, String> {
    let start = text.len() - text.trim_start().len();
    let rest = &text[start..];
    let Some(after) = rest.strip_prefix(':') else {
        return Err("@param names a parameter: @param :name = <literal>".into());
    };
    let (name, name_end) = if let Some(quoted) = after.strip_prefix('"') {
        let close = quoted.find('"').ok_or("the name of @param misses its closing quote")?;
        (&quoted[..close], start + 1 + close + 2)
    } else {
        let end = after.find(|c: char| c.is_whitespace() || c == '=').unwrap_or(after.len());
        (&after[..end], start + 1 + end)
    };
    if name.is_empty() {
        return Err("@param names a parameter: @param :name = <literal>".into());
    }
    let tail = &text[name_end..];
    let trimmed = tail.trim_start();
    if trimmed.is_empty() {
        return Ok(ParamTagParts { name, name_range: start..name_end, literal: None });
    }
    let Some(value) = trimmed.strip_prefix('=') else {
        return Err(format!("@param :{name} takes its value after =, e.g. @param :{name} = 10"));
    };
    let value_start = text.len() - value.trim_start().len();
    let value_end = value_start + value.trim().len();
    Ok(ParamTagParts { name, name_range: start..name_end, literal: Some(value_start..value_end) })
}

fn warn(state: &mut AnalysisState, span: TextSpan, message: String) {
    state.out.errors.push(AnalyzerError {
        error_type: AnalyzerErrorType::INVALID_PARAM_TAG,
        severity: AnalyzerErrorSeverity::WARNING,
        ast_node_id: None,
        symbol_span: None,
        text_span: Some(span),
        message,
    });
}

/// Read the `@param` tags of the statements
pub(super) fn analyze(state: &mut AnalysisState) {
    let parsed = state.parsed;
    let script = parsed.scanned.text.as_str();
    let blocks = &parsed.comment_blocks;
    let descriptions = parsed.associate_descriptions();
    for statement_id in 0..parsed.statements.len() {
        let Some(description) = descriptions.get(statement_id) else { continue };
        let begin = description.description_blocks_begin as usize;
        let count = description.description_blocks_count as usize;
        for block in &blocks.blocks[begin..begin + count] {
            if block.block_type != CommentBlockType::DASHQL_TAG
                || &script[block.tag_span.offset as usize..block.tag_span.end() as usize] != PARAM_TAG
            {
                continue;
            }
            let lines = &blocks.lines[block.lines_begin as usize..(block.lines_begin + block.lines_count) as usize];
            let tag = TagText::new(script, lines, block.text_span);
            // A Javadoc `@param x ...` is a comment, not a value
            if !tag.text.trim_start().starts_with(':') {
                continue;
            }
            let parts = match split_param_tag(&tag.text) {
                Ok(parts) => parts,
                Err(message) => {
                    warn(state, block.tag_span, message);
                    continue;
                }
            };
            let name_span = tag.span(parts.name_range.start, parts.name_range.end);
            if state.out.param_values.iter().any(|i| &*i.name == parts.name) {
                warn(state, name_span, format!("the script already has a value for @param :{}, this tag is ignored", parts.name));
                continue;
            }
            let literal = match parts.literal.clone() {
                None => None,
                Some(range) => match SqlLiteral::parse(&tag.text[range.clone()]) {
                    Ok(literal) => Some(literal),
                    Err(message) => {
                        warn(state, tag.span(range.start, range.end), message);
                        None
                    }
                },
            };
            state.out.param_values.push(ParamTag {
                statement_id: statement_id as u32,
                name: Arc::from(parts.name),
                literal,
                text_span: block.text_span,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::split_param_tag;

    fn split(text: &str) -> Result<(&str, Option<&str>), String> {
        split_param_tag(text).map(|p| (p.name, p.literal.map(|r| &text[r])))
    }

    #[test]
    fn splits_name_and_literal() {
        assert_eq!(split(":min = 10"), Ok(("min", Some("10"))));
        assert_eq!(split("  :span=interval '3 days' "), Ok(("span", Some("interval '3 days'"))));
        assert_eq!(split(":min"), Ok(("min", None)));
        assert_eq!(split(":\"foo 2\" = 'a'"), Ok(("foo 2", Some("'a'"))));
        assert_eq!(split(":min ="), Ok(("min", Some(""))));
        assert!(split("min = 10").is_err());
        assert!(split(":min 10").is_err());
        assert!(split(":").is_err());
        assert!(split("x the x").is_err());
        assert!(split(":\"open").is_err());
    }
}
