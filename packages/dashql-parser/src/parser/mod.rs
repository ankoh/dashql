//! The parser: the grammar actions (`//grammar:parser_tables_rs`), the parse context, and the LALR(1) driver.

pub mod actions;
pub mod context;
pub mod driver;
pub mod probe;
pub mod syntax_error;
pub mod value;

use crate::comment_blocks::{group_comments, CommentBlocks};
use crate::scanner::ScannedScript;
use crate::span::TextSpan;
pub use context::{ParseError, Statement};
use dashql_buffers::parser::{AttributeKey, Node, NodeType};
use std::sync::Arc;

/// A parsed script
#[derive(Clone, Debug)]
pub struct ParsedScript {
    /// The scanned script, including the names that the parser registered
    pub scanned: Arc<ScannedScript>,
    /// The AST nodes in post-order
    pub nodes: Vec<Node>,
    /// The statements
    pub statements: Vec<Statement>,
    /// The parser errors
    pub errors: Vec<ParseError>,
    /// The comments grouped into blocks
    pub comment_blocks: CommentBlocks,
}

/// Source spans and description comments of a statement
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StatementDescription {
    /// The text of the statement root
    pub statement_span: TextSpan,
    /// The statement source, including the terminating semicolon and trailing comments on its line
    pub source_span: TextSpan,
    /// The description comments (a slice of the comments of the script)
    pub description_begin: u32,
    /// The number of description comments
    pub description_count: u32,
    /// The comment blocks of the description comments (a slice of the comment blocks of the script)
    pub description_blocks_begin: u32,
    /// The number of comment blocks of the description comments
    pub description_blocks_count: u32,
}

/// Only whitespace and semicolons
fn is_description_gap(text: &[u8], begin: usize, end: usize) -> bool {
    text.get(begin..end.max(begin))
        .unwrap_or_default()
        .iter()
        .all(|c| matches!(c, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c' | b';'))
}

/// The end of the statement source, including comments that trail its terminating semicolon on the
/// same line
fn statement_source_end(text: &[u8], sql_end: usize, limit: usize, comments: &[TextSpan]) -> usize {
    let mut end = sql_end;
    for comment in comments {
        let offset = comment.offset as usize;
        if offset < end || offset >= limit {
            continue;
        }
        if !is_description_gap(text, end, offset) {
            break;
        }
        if text.get(end..offset).unwrap_or_default().iter().any(|&c| c == b'\n' || c == b'\r') {
            break;
        }
        end = comment.end() as usize;
    }
    end
}

/// A leading description comment must start on a fresh line when it follows prior SQL
fn is_leading_description_comment_gap(text: &[u8], previous_end: usize, comment: TextSpan) -> bool {
    let offset = comment.offset as usize;
    if !is_description_gap(text, previous_end, offset) {
        return false;
    }
    if previous_end == 0 || offset == 0 {
        return true;
    }
    text.get(previous_end..offset).unwrap_or_default().iter().any(|&c| c == b'\n' || c == b'\r')
}

impl ParsedScript {
    /// The children of a node
    pub fn children(&self, node: &Node) -> &[Node] {
        let begin = node.children_begin_or_value() as usize;
        self.nodes.get(begin..begin + node.children_count() as usize).unwrap_or_default()
    }

    /// The id of a node of this script, its index in `nodes`
    pub fn node_id(&self, node: &Node) -> u32 {
        ((node as *const Node as usize - self.nodes.as_ptr() as usize) / std::mem::size_of::<Node>()) as u32
    }

    /// The text of a node
    pub fn node_text(&self, node: &Node) -> &str {
        let scanned = &*self.scanned;
        let span = context::resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
        let begin = (span.offset as usize).min(scanned.text.len());
        let end = (begin + span.length as usize).min(scanned.text.len());
        scanned.text.get(begin..end).unwrap_or_default()
    }

    /// Derive source spans and contiguous description comment blocks
    pub fn associate_descriptions(&self) -> Vec<StatementDescription> {
        let scanned = &*self.scanned;
        let input = scanned.text.as_bytes();
        let comments = &scanned.comments;
        let resolve = |node: u32| {
            let Some(node) = self.nodes.get(node as usize) else { return TextSpan::default() };
            context::resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span())
        };
        let mut metadata = Vec::with_capacity(self.statements.len());

        // AST root spans exclude statement separators and comments. Extend each root to its first
        // following semicolon before the next statement's root.
        for (i, statement) in self.statements.iter().enumerate() {
            let root_span = resolve(statement.root);
            let mut end = root_span.end() as usize;
            let next_begin = match self.statements.get(i + 1) {
                Some(next) => resolve(next.root).offset as usize,
                None => input.len(),
            };
            let mut cursor = end;
            while cursor < next_begin {
                if let Some(comment) =
                    comments.iter().find(|c| (c.offset as usize) <= cursor && cursor < c.end() as usize)
                {
                    cursor = comment.end() as usize;
                    continue;
                }
                if input.get(cursor) == Some(&b';') {
                    end = cursor + 1;
                    break;
                }
                cursor += 1;
            }
            let end = statement_source_end(input, end, next_begin, comments);
            metadata.push(StatementDescription {
                statement_span: root_span,
                source_span: TextSpan::new(root_span.offset, (end - root_span.offset as usize) as u32),
                ..Default::default()
            });
        }

        let mut comment_cursor = 0;
        let mut previous_end = 0;
        let mut block_cursor = 0;
        let blocks = &self.comment_blocks.blocks;
        for statement in metadata.iter_mut() {
            while comments.get(comment_cursor).is_some_and(|c| (c.offset as usize) < previous_end) {
                comment_cursor += 1;
            }
            let mut begin = comment_cursor;
            let mut end = begin;
            let mut cursor = previous_end;
            while let Some(&comment) = comments.get(end) {
                if comment.offset >= statement.source_span.offset {
                    break;
                }
                let allowed = if end == begin {
                    is_leading_description_comment_gap(input, cursor, comment)
                } else {
                    is_description_gap(input, cursor, comment.offset as usize)
                };
                if !allowed {
                    begin = end + 1;
                }
                cursor = comment.end() as usize;
                end += 1;
            }
            if begin < end && is_description_gap(input, cursor, statement.source_span.offset as usize) {
                statement.description_begin = begin as u32;
                statement.description_count = (end - begin) as u32;
                // Blocks never straddle the description comments
                while blocks.get(block_cursor).is_some_and(|b| (b.comments_begin as usize) < begin) {
                    block_cursor += 1;
                }
                statement.description_blocks_begin = block_cursor as u32;
                while blocks.get(block_cursor).is_some_and(|b| (b.comments_begin as usize) < end) {
                    block_cursor += 1;
                }
                statement.description_blocks_count = block_cursor as u32 - statement.description_blocks_begin;
            }
            previous_end = statement.source_span.end() as usize;
            comment_cursor = end;
        }
        metadata
    }
}

/// Parse a scanned script.
///
/// The parser registers names (keywords used as names) and may update the replacements of
/// obfuscated literals, so the returned parsed script owns an updated copy of the scanned script
/// unless `scanned` is not shared.
pub fn parse(scanned: Arc<ScannedScript>) -> ParsedScript {
    let mut scanned = Arc::try_unwrap(scanned).unwrap_or_else(|shared| (*shared).clone());
    let names = std::mem::take(&mut scanned.names);
    let state = {
        let mut ctx = context::ParseContext::new(&scanned.text, &scanned.symbols, names);
        driver::parse(&mut ctx);
        ctx.into_state()
    };
    scanned.names = state.names;

    let comment_blocks = group_comments(&scanned.text, &scanned.comments);
    replace_obfuscated_cast_literals(&mut scanned, &state.nodes);
    ParsedScript {
        scanned: Arc::new(scanned),
        nodes: state.nodes,
        statements: state.statements,
        errors: state.errors,
        comment_blocks,
    }
}

/// Obfuscated strings that are cast to a type need a replacement that the type accepts, e.g.
/// `timestamptz /*String(A834)*/` cannot become `timestamptz 'A834'`.
fn replace_obfuscated_cast_literals(scanned: &mut ScannedScript, nodes: &[Node]) {
    if scanned.obfuscated_literals.is_empty() {
        return;
    }
    for node in nodes {
        if node.node_type() != NodeType::LITERAL_STRING || node.attribute_key() != AttributeKey::SQL_CONST_CAST_VALUE {
            continue;
        }
        let Some(&cast) = nodes.get(node.parent() as usize) else { continue };
        if !matches!(
            cast.node_type(),
            NodeType::OBJECT_SQL_CONST_TYPE_CAST
                | NodeType::OBJECT_SQL_CONST_FUNCTION_CAST
                | NodeType::OBJECT_SQL_CONST_INTERVAL_CAST
        ) {
            continue;
        }
        let literal_span = context::resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
        let Ok(i) = scanned.obfuscated_literals.binary_search_by_key(&literal_span.offset, |l| l.location.offset)
        else {
            continue;
        };
        // The type is the text of the cast in front of the literal, e.g. "timestamp with time zone"
        let cast_span = context::resolve_text_span(&scanned.text, &scanned.symbols, *cast.symbol_span());
        let type_text = scanned
            .text
            .get(cast_span.offset as usize..literal_span.offset as usize)
            .unwrap_or_default()
            .to_ascii_lowercase();
        let Some(literal) = scanned.obfuscated_literals.get_mut(i) else { continue };
        let hash = literal.replacement.get(1..5).unwrap_or_default().to_string();
        let has = |s: &str| type_text.contains(s);
        let replacement = if has("timestamp") {
            "'2000-01-01 00:00:00'".to_string()
        } else if has("date") {
            "'2000-01-01'".to_string()
        } else if has("time") {
            "'00:00:00'".to_string()
        } else if has("interval") {
            "'1'".to_string()
        } else if has("uuid") {
            format!("'00000000-0000-0000-0000-00000000{hash}'")
        } else if has("json") {
            "'{}'".to_string()
        } else if has("bool") {
            "'true'".to_string()
        } else if ["int", "numeric", "decimal", "real", "double", "float"].iter().any(|s| has(s)) {
            format!("'{}'", u32::from_str_radix(&hash, 16).unwrap_or(0))
        } else {
            continue;
        };
        literal.replacement = replacement;
    }
}

#[cfg(test)]
mod transaction_tests;

#[cfg(test)]
mod hyper_cases;
#[cfg(test)]
mod hyper_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::scan;

    fn parse_text(text: &str) -> ParsedScript {
        parse(Arc::new(scan(text, 0, 0)))
    }

    #[test]
    fn parses_select() {
        let parsed = parse_text("select 1");
        assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
        assert_eq!(parsed.statements.len(), 1);
        let root = parsed.nodes[parsed.statements[0].root as usize];
        assert_eq!(root.node_type(), NodeType::OBJECT_SQL_SELECT);
    }

    /// The depth of the deepest node, the roots have depth 1
    fn tree_depth(parsed: &ParsedScript) -> usize {
        // Post-order: a parent comes after its children
        let mut depths = vec![0usize; parsed.nodes.len()];
        for (i, node) in parsed.nodes.iter().enumerate().rev() {
            let parent = depths.get(node.parent() as usize).copied().unwrap_or(0);
            depths[i] = parent + 1;
        }
        depths.into_iter().max().unwrap_or(0)
    }

    fn nested(open: &str, inner: &str, close: &str, depth: usize) -> String {
        format!("{}{inner}{}", open.repeat(depth), close.repeat(depth))
    }

    #[test]
    fn parses_nesting_below_the_depth_limit() {
        for text in [
            format!("select {}", nested("(", "1", ")", 300)),
            format!("select {}", nested("f(", "1", ")", 100)),
            format!("select * from {}", nested("(select * from ", "x", ") t", 50)),
            format!("call ns.f(x => {})", nested("[", "1", "]", 300)),
        ] {
            let parsed = parse_text(&text);
            assert!(parsed.errors.is_empty(), "{:?}", parsed.errors);
            assert_eq!(parsed.statements.len(), 1);
        }
    }

    #[test]
    fn drops_a_statement_that_nests_too_deep() {
        for deep in [
            format!("select {}", nested("(", "1", ")", 100_000)),
            format!("select {}", nested("f(", "1", ")", 100_000)),
            format!("call ns.f(x => {})", nested("[", "1", "]", 100_000)),
            format!("select {}1", "- ".repeat(100_000)),
            format!("select {}true", "not ".repeat(100_000)),
            format!("select {}", nested("case when true then ", "1", " end", 10_000)),
        ] {
            let parsed = parse_text(&format!("select 1; {deep}; select 2"));
            // One error, the parser skips the rest of the statement and parses the next one
            let head = deep.get(..20).unwrap_or_default();
            let errors: Vec<_> = parsed.errors.iter().map(|e| e.message.as_str()).collect();
            assert_eq!(errors, [driver::NESTING_TOO_DEEP], "{head}");
            let statements: Vec<String> = parsed
                .statements
                .iter()
                .map(|statement| {
                    let span = context::resolve_text_span(
                        &parsed.scanned.text,
                        &parsed.scanned.symbols,
                        *parsed.nodes[statement.root as usize].symbol_span(),
                    );
                    parsed.scanned.text[span.offset as usize..span.end() as usize].to_string()
                })
                .collect();
            assert_eq!(statements, ["select 1", "select 2"], "{head}");
            assert!(tree_depth(&parsed) < 20, "{head}: {}", tree_depth(&parsed));
        }
    }

    #[test]
    fn reports_syntax_errors() {
        let parsed = parse_text("select * from foo select");
        assert_eq!(parsed.statements.len(), 0);
        assert_eq!(parsed.errors.len(), 1);
        assert!(parsed.errors[0].message.starts_with("syntax error, unexpected keyword SELECT"), "{:?}", parsed.errors);
    }
}
