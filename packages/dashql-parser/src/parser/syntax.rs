//! Syntax-only SQL coverage. A retry must recognize a complete statement with the Hyper grammar;
//! failed retries never replace the semantic parser's diagnostics. No engine code runs here.

use super::actions::{attr, const_node, name_from_identifier, operator_node};
use super::context::{ParseContext, State};
use super::driver::{MAX_STACK_DEPTH, NESTING_TOO_DEEP};
use super::syntax_keywords::keyword;
use super::syntax_tables::{self as tables, symbol_kind as s};
use crate::scanner::{ScannedScript, Symbol, SymbolValue};
use crate::symbol_kind as d;
use dashql_buffers::parser::{AConstType, AttributeKey as Key, Node, NodeType, SymbolSpan};

/// One token in the syntax grammar, located in the original scanner token stream.
struct Token {
    kind: u16,
    span: SymbolSpan,
}

/// Reclassify keywords without changing the semantic grammar's scanner or reserving new names there.
fn token_kind(scanned: &ScannedScript, symbol: &Symbol) -> u16 {
    let text = scanned.text.get(symbol.location.offset as usize..symbol.location.end() as usize).unwrap_or_default();
    let quoted = text.starts_with(['"', '`']) || text.get(..3).is_some_and(|s| s.eq_ignore_ascii_case("u&\""));
    if !quoted && text.as_bytes().first().is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_') {
        // E'', N'', and U&'' are literals, not identifiers or keywords.
        if text.ends_with('\'') {
            return s::S_SCONST;
        }
        return keyword(&text.to_ascii_lowercase()).unwrap_or(s::S_IDENT);
    }
    match symbol.kind {
        d::S_YYEOF => s::S_YYEOF,
        d::S_IDENT => s::S_IDENT,
        d::S_ICONST => s::S_ICONST,
        d::S_FCONST => s::S_FCONST,
        d::S_SCONST | d::S_DCONST => s::S_SCONST,
        d::S_BCONST => s::S_BCONST,
        d::S_XCONST => s::S_XCONST,
        d::S_PARAM => s::S_QUESTION_MARK,
        d::S_TYPECAST => s::S_TYPECAST,
        d::S_COLON_EQUALS => s::S_COLON_EQUALS,
        d::S_EQUALS_GREATER => s::S_EQUALS_GREATER,
        d::S_LESS_EQUALS => s::S_LESS_EQUALS,
        d::S_GREATER_EQUALS => s::S_GREATER_EQUALS,
        d::S_NOT_EQUALS => s::S_NOT_EQUALS,
        d::S_LRB => s::S_LRB,
        d::S_RRB => s::S_RRB,
        d::S_LSB => s::S_LSB,
        d::S_RSB => s::S_RSB,
        d::S_LCB => s::S_LCB,
        d::S_RCB => s::S_RCB,
        d::S_COMMA => s::S_COMMA,
        d::S_COLON => s::S_COLON,
        d::S_DOT | d::S_DOT_TRAILING | d::S_DOT_STAR_LA => s::S_DOT,
        d::S_PLUS => s::S_PLUS,
        d::S_MINUS => s::S_MINUS,
        d::S_STAR => s::S_STAR,
        d::S_DIVIDE => s::S_DIVIDE,
        d::S_MODULO => s::S_MODULO,
        d::S_CIRCUMFLEX => s::S_CIRCUMFLEX,
        d::S_LESS_THAN => s::S_LESS_THAN,
        d::S_GREATER_THAN => s::S_GREATER_THAN,
        d::S_EQUALS => s::S_EQUALS,
        d::S_AMPERSAND => s::S_AMPERSAND,
        d::S_PIPE => s::S_PIPE,
        d::S_EXCLAMATION_MARK => s::S_EXCLAMATION_MARK,
        d::S_Op => s::S_Op,
        _ => s::S_YYUNDEF,
    }
}

fn tokens(scanned: &ScannedScript, symbols: &[Symbol]) -> Vec<Token> {
    let mut out = Vec::with_capacity(symbols.len() + 1);
    let mut i = 0;
    while let Some(symbol) = symbols.get(i) {
        let mut kind = token_kind(scanned, symbol);
        let mut length = 1;
        if symbol.kind == d::S_DOLLAR {
            if let Some(next) = symbols.get(i + 1) {
                if next.kind == d::S_ICONST && symbol.location.end() == next.location.offset {
                    kind = s::S_PARAM;
                    length = 2;
                }
            }
        }
        out.push(Token { kind, span: SymbolSpan::new(i as u32, length) });
        i += length as usize;
    }
    for i in 0..out.len() {
        let next = out.get(i + 1).map_or(s::S_YYEOF, |t| t.kind);
        let Some(token) = out.get_mut(i) else { continue };
        token.kind = match (token.kind, next) {
            (s::S_NOT, s::S_BETWEEN | s::S_IN_P | s::S_LIKE | s::S_ILIKE | s::S_SIMILAR) => s::S_NOT_LA,
            (s::S_NULLS_P, s::S_FIRST_P | s::S_LAST_P) => s::S_NULLS_LA,
            (s::S_WITH, s::S_AGGREGATION_THRESHOLD | s::S_ORDINALITY | s::S_TIME) => s::S_WITH_LA,
            (s::S_WITH, s::S_OPTIONS) => s::S_WITH_OPTIONS_LA,
            (s::S_WITHOUT, s::S_TIME) => s::S_WITHOUT_LA,
            (s::S_ARRAY, s::S_LRB | s::S_WRAPPER) => s::S_ARRAY_LA,
            (s::S_FORMAT, s::S_JSON) => s::S_FORMAT_LA,
            (s::S_DOT, s::S_STAR) => s::S_DOT_LA,
            _ => token.kind,
        };
    }
    out.push(Token { kind: s::S_YYEOF, span: SymbolSpan::new(symbols.len() as u32, 0) });
    out
}

fn terminal(ctx: &ParseContext, token: &Token) -> Node {
    let constant = match token.kind {
        s::S_ICONST => Some(AConstType::INTEGER),
        s::S_FCONST => Some(AConstType::FLOAT),
        s::S_SCONST | s::S_BCONST | s::S_XCONST => Some(AConstType::STRING),
        _ => None,
    };
    if let Some(constant) = constant {
        return const_node(token.span, constant);
    }
    if token.kind == s::S_IDENT {
        if let Some(symbol) = ctx.symbols().get(token.span.offset() as usize) {
            let id = match symbol.value {
                SymbolValue::Name(id) => id,
                _ => ctx
                    .state
                    .borrow_mut()
                    .names
                    .register(&ctx.text_at(token.span).to_ascii_lowercase(), symbol.location),
            };
            return name_from_identifier(token.span, id);
        }
    }
    operator_node(token.span)
}

/// Preserve the reduction's rule and all its children, including punctuation and empty productions.
fn syntax_node(ctx: &ParseContext, rule: &str, span: SymbolSpan, children: &[Node]) -> Node {
    let name = ctx.state.borrow_mut().names.register(rule, crate::span::TextSpan::default());
    ctx.object(
        span,
        NodeType::OBJECT_SQL_SYNTAX,
        &[
            attr(Key::SQL_SYNTAX_RULE, name_from_identifier(SymbolSpan::new(span.offset(), 0), name)),
            attr(Key::SQL_SYNTAX_CHILDREN, ctx.array_ex(span, children, false, false)),
        ],
    )
}

/// Recognize one complete statement. There are no recovery productions in this grammar.
fn parse(ctx: &mut ParseContext, input: &[Token]) -> bool {
    let mut states = vec![0i32];
    let mut nodes: Vec<Node> = vec![Node::default()];
    let mut cursor = 0;
    let mut root = None;
    loop {
        let state = *states.last().unwrap_or(&-1);
        if state == tables::YYFINAL {
            if let Some(root) = root {
                ctx.add_statement(root);
                return true;
            }
            return false;
        }
        let Some(token) = input.get(cursor) else { return false };
        let Some(&pact) = tables::YYPACT.get(state as usize) else { return false };
        let index = pact + token.kind as i32;
        let explicit = pact != tables::YYPACT_NINF
            && (0..=tables::YYLAST).contains(&index)
            && tables::YYCHECK.get(index as usize).map(|&v| v as i32) == Some(token.kind as i32);
        let action = if explicit {
            tables::YYTABLE.get(index as usize).map(|&v| v as i32)
        } else {
            tables::YYDEFACT.get(state as usize).map(|&r| -(r as i32))
        };
        let Some(action) = action else { return false };
        if action == 0 || (explicit && action == tables::YYTABLE_NINF) {
            return false;
        }
        if action > 0 {
            if states.len() >= MAX_STACK_DEPTH {
                return false;
            }
            states.push(action);
            nodes.push(terminal(ctx, token));
            cursor += 1;
            continue;
        }
        let rule = -action as usize;
        let Some(&length) = tables::YYR2.get(rule) else { return false };
        let Some(&lhs) = tables::YYR1.get(rule) else { return false };
        let Some(begin) = nodes.len().checked_sub(length as usize) else { return false };
        let children = nodes.get(begin..).unwrap_or_default();
        let span = match (children.first(), children.last()) {
            (Some(first), Some(last)) => SymbolSpan::new(
                first.symbol_span().offset(),
                last.symbol_span().offset() + last.symbol_span().length() - first.symbol_span().offset(),
            ),
            _ => {
                let below = nodes.last().map(|n| n.symbol_span()).copied().unwrap_or_default();
                SymbolSpan::new(below.offset() + below.length(), 0)
            }
        };
        let Some(name) = tables::YYTNAME.get(lhs as usize) else { return false };
        let node = syntax_node(ctx, name, span, children);
        if lhs as u16 == s::S_Stmt {
            root = Some(node);
        }
        states.truncate(begin);
        nodes.truncate(begin);
        let state = *states.last().unwrap_or(&-1);
        let nterm = lhs as usize - tables::YYNTOKENS;
        let Some(&pgoto) = tables::YYPGOTO.get(nterm) else { return false };
        let index = pgoto as i32 + state;
        let next = if (0..=tables::YYLAST).contains(&index)
            && tables::YYCHECK.get(index as usize).map(|&v| v as i32) == Some(state)
        {
            tables::YYTABLE.get(index as usize).map(|&v| v as i32)
        } else {
            tables::YYDEFGOTO.get(nterm).map(|&v| v as i32)
        };
        let Some(next) = next else { return false };
        states.push(next);
        nodes.push(node);
    }
}

/// Rebase a statement-local node into the script's flat node array and scanner symbol stream.
fn rebase(node: &Node, symbols_begin: u32, nodes_begin: u32) -> Node {
    let span = SymbolSpan::new(node.symbol_span().offset() + symbols_begin, node.symbol_span().length());
    let children = node.children_begin_or_value();
    let children = if (node.node_type() == NodeType::ARRAY || node.node_type().0 > NodeType::OBJECT_KEYS_.0)
        && node.children_count() > 0
    {
        children + nodes_begin
    } else {
        children
    };
    Node::new(
        &span,
        node.node_type(),
        node.attribute_key(),
        node.parent().checked_add(nodes_begin).unwrap_or(super::context::NO_PARENT),
        children,
        node.children_count(),
    )
}

/// Retry statements independently; only replace the original parse if at least one retry succeeds.
pub(super) fn recover(scanned: &ScannedScript, original: State) -> State {
    if original.errors.is_empty() {
        return original;
    }
    let mut result = State::default();
    result.names = original.names.clone();
    let mut recovered = false;
    let mut begin = 0;
    for (end, symbol) in scanned.symbols.iter().enumerate() {
        if !matches!(symbol.kind, d::S_SEMICOLON | d::S_YYEOF) {
            continue;
        }
        if begin < end {
            let Some(symbols) = scanned.symbols.get(begin..end) else { continue };
            let mut ctx = ParseContext::new(&scanned.text, symbols, std::mem::take(&mut result.names));
            super::driver::parse(&mut ctx);
            let mut local = ctx.into_state();
            // Retry LR syntax failures, not deliberate grammar-action validation (e.g. invalid
            // FLOAT precision or malformed graph connectors). Those diagnostics remain useful.
            if !local.errors.is_empty()
                && local.errors.iter().all(|e| {
                    e.message != NESTING_TOO_DEEP
                        && (e.message == "syntax error" || e.message.starts_with("syntax error, unexpected "))
                })
            {
                let mut ctx = ParseContext::new(&scanned.text, symbols, local.names.clone());
                if parse(&mut ctx, &tokens(scanned, symbols)) {
                    local = ctx.into_state();
                    recovered = true;
                }
            }
            let nodes_begin = result.nodes.len() as u32;
            result.nodes.extend(local.nodes.iter().map(|node| rebase(node, begin as u32, nodes_begin)));
            for mut statement in local.statements {
                statement.root += nodes_begin;
                statement.nodes_begin += nodes_begin;
                result.statements.push(statement);
            }
            for mut error in local.errors {
                error.location = SymbolSpan::new(error.location.offset() + begin as u32, error.location.length());
                result.errors.push(error);
            }
            result.names = local.names;
        }
        begin = end + 1;
    }
    // Leading semicolons can also be accepted by the strict per-statement grammar.
    if recovered || (result.errors.is_empty() && !result.statements.is_empty()) {
        result
    } else {
        original
    }
}
