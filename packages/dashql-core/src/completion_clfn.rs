//! Completion inside a `CALL` of a namespace with client functions: its functions, options and nested attributes.
//!
//! The text being typed usually doesn't parse, so the position comes from the tokens, not the tree. A walk from the
//! start of the statement keeps a stack with the schema of every open `(` and `[`. A wrong decision here only affects
//! suggestions, since nothing of this is part of parsing.

use crate::catalog::clfn::{ClientFunctionAttribute, ClientFunctionField, ClientFunction, ClientFunctionSchema, ClientFunctionSpec, ClientFunctionUnknownPolicy};
use crate::catalog::CatalogSnapshot;
use crate::completion::{Candidate, CandidateTags, Completion, Score};
use crate::utils::quote_identifier;
use dashql_buffers::completion::CandidateTag;
use dashql_buffers::parser::SymbolSpan;
use dashql_parser::scanner::Symbol;
use dashql_parser::symbol_kind::*;
use dashql_parser::keywords::Keyword;
use dashql_parser::SymbolKind;
use std::sync::Arc;

/// The score of a required option, it ranks before every other candidate
const REQUIRED_BONUS: Score = 1 << 20;
/// The score of a prefix match over a substring match
const PREFIX_BONUS: Score = 1 << 18;
/// The score of an option of the spec over a standard option
const SPEC_OPTION_BONUS: Score = 1;

/// Can a token be the name of a function, an option or an attribute?
fn is_name(kind: SymbolKind) -> bool {
    kind == S_IDENT || Keyword::name_of(kind).is_some_and(|name| !name.is_empty())
}

/// What an open bracket holds
enum Frame<'s> {
    /// The options of the function
    Options(&'s ClientFunction),
    /// The fields of an object: its schema, None for a free-form object
    Fields(Option<&'s ClientFunctionSchema>),
    /// The items of an array of the attribute
    Items(Option<&'s ClientFunctionAttribute>),
    /// Anything else, such as the arguments of a function
    Opaque,
}

/// A frame and its names so far
struct Scope<'s> {
    frame: Frame<'s>,
    /// The names that are used already in lower case, with their values if they are strings
    used: Vec<ClientFunctionField>,
    /// The attribute of the value being read
    attribute: Option<&'s ClientFunctionAttribute>,
    /// Is the next token a key?
    at_key: bool,
}

impl<'s> Scope<'s> {
    fn new(frame: Frame<'s>) -> Self {
        let at_key = matches!(frame, Frame::Options(_) | Frame::Fields(_));
        Self { frame, used: Vec::new(), attribute: None, at_key }
    }

    /// The attributes that a key selects from and if they are required. A union offers what its variants that still
    /// fit take, and an attribute is only required if all of them need it.
    fn attributes(&self, spec: &'s ClientFunctionSpec) -> Vec<(&'s ClientFunctionAttribute, bool)> {
        match self.frame {
            Frame::Options(function) => function.options.iter().map(|o| (o, o.required)).collect(),
            Frame::Fields(Some(schema)) => {
                let variants = spec.fit(schema, &self.used).variants;
                let mut out: Vec<(&'s ClientFunctionAttribute, bool)> = Vec::new();
                for attribute in variants.iter().flat_map(|v| v.attributes.iter()) {
                    if !out.iter().any(|(a, _)| a.name == attribute.name) {
                        let required = variants.iter().all(|v| v.attributes.iter().any(|a| a.name == attribute.name && a.required));
                        out.push((attribute, required));
                    }
                }
                out
            }
            _ => Vec::new(),
        }
    }
}

/// Where the cursor is
enum Position<'s> {
    /// After `CALL`: the namespaces
    Namespace,
    /// After the namespace: its functions
    Function(&'s ClientFunctionSpec),
    /// A key of a scope
    Key(&'s ClientFunctionSpec, Scope<'s>),
    /// Somewhere that takes no candidates
    Nothing,
    /// Not in a call of a namespace with a spec
    Outside,
}

/// Does an opening parenthesis start embedded SQL? `(select = 1)` is an object, `(select 1)` a query.
fn starts_embedded_sql(symbols: &[Symbol], paren: usize) -> bool {
    let mut next = paren + 1;
    while symbols.get(next).is_some_and(|s| s.kind == S_LRB) {
        next += 1;
    }
    let Some(first) = symbols.get(next) else { return false };
    let follower = symbols.get(next + 1).map(|s| s.kind);
    match first.kind {
        S_SELECT | S_WITH | S_WITH_LA | S_TABLE => follower != Some(S_EQUALS),
        S_VALUES => follower == Some(S_LRB),
        _ => false,
    }
}

/// The text of a token in lower case
fn token_text(completion: &Completion, symbol: &Symbol) -> String {
    let text = completion.text_at(symbol.location.offset, symbol.location.length);
    String::from_utf8_lossy(text).trim_matches('"').to_ascii_lowercase()
}

/// Find the position in the tokens of a statement before the target token
fn find_position<'s>(completion: &Completion, specs: &'s CatalogSnapshot, symbols: &[Symbol]) -> Position<'s> {
    let mut i = 0;
    if symbols.get(i).is_some_and(|s| s.kind == S_EXPLAIN) {
        i += 1;
    }
    if symbols.get(i).is_none_or(|s| s.kind != S_CALL_P) {
        return Position::Outside;
    }
    i += 1;
    // The namespace
    if i == symbols.len() {
        return Position::Namespace;
    }
    let Some(namespace) = symbols.get(i).filter(|s| is_name(s.kind)) else { return Position::Outside };
    let Some(spec) = specs.client_function_spec(&token_text(completion, namespace)) else { return Position::Outside };
    i += 1;
    let Some(dot) = symbols.get(i) else { return Position::Outside };
    if dot.kind != S_DOT && dot.kind != S_DOT_TRAILING {
        return Position::Outside;
    }
    i += 1;
    // The function
    let Some(function) = symbols.get(i) else { return Position::Function(spec) };
    let Some(function) = Some(function).filter(|s| is_name(s.kind)).and_then(|s| spec.function(&token_text(completion, s))) else {
        return Position::Nothing;
    };
    i += 1;
    let Some(open) = symbols.get(i) else { return Position::Nothing };
    if open.kind != S_LRB {
        return Position::Nothing;
    }
    i += 1;

    let mut stack = vec![Scope::new(Frame::Options(function))];
    while let Some(symbol) = symbols.get(i) {
        let Some(top) = stack.last_mut() else { return Position::Outside };
        match symbol.kind {
            S_RRB | S_RSB => {
                stack.pop();
                if stack.is_empty() {
                    return Position::Outside;
                }
            }
            S_COMMA => {
                top.attribute = top.attribute.filter(|_| matches!(top.frame, Frame::Items(_)));
                top.at_key = matches!(top.frame, Frame::Options(_) | Frame::Fields(_));
            }
            S_LRB if matches!(top.frame, Frame::Opaque) => stack.push(Scope::new(Frame::Opaque)),
            S_LRB if top.at_key => stack.push(Scope::new(Frame::Opaque)),
            S_LRB => {
                // A name before the parenthesis is a function, the analyzer rejects it
                if i > 0 && is_name(symbols[i - 1].kind) {
                    stack.push(Scope::new(Frame::Opaque));
                } else if starts_embedded_sql(symbols, i) {
                    // Skip the query. If the cursor is inside it, core SQL completes it.
                    let mut depth = 0;
                    while let Some(s) = symbols.get(i) {
                        match s.kind {
                            S_LRB => depth += 1,
                            S_RRB => depth -= 1,
                            _ => {}
                        }
                        if depth == 0 {
                            break;
                        }
                        i += 1;
                    }
                    if depth != 0 {
                        return Position::Outside;
                    }
                } else {
                    let attribute = match top.frame {
                        Frame::Items(attribute) => attribute,
                        _ => top.attribute,
                    };
                    let schema = attribute.and_then(|a| a.schema.as_deref()).and_then(|s| spec.schema(s));
                    stack.push(Scope::new(Frame::Fields(schema)));
                }
            }
            S_LSB => {
                let attribute = match top.frame {
                    Frame::Items(attribute) => attribute,
                    Frame::Opaque => None,
                    _ => top.attribute,
                };
                stack.push(Scope::new(Frame::Items(attribute)));
            }
            S_EQUALS | S_EQUALS_GREATER => {}
            _ if top.at_key => {
                // A key: remember its attribute for the value that follows
                let text = token_text(completion, symbol);
                top.used.push(ClientFunctionField { name: text.clone(), ..Default::default() });
                top.attribute = top.attributes(spec).into_iter().map(|(a, _)| a).find(|a| a.name.eq_ignore_ascii_case(&text));
                top.at_key = false;
            }
            // The value of the key, it can select the variant of a union
            S_SCONST => {
                if let Some(field) = top.used.last_mut() {
                    field.text = Some(token_text(completion, symbol).trim_matches('\'').to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }
    let Some(top) = stack.pop() else { return Position::Outside };
    if top.at_key { Position::Key(spec, top) } else { Position::Nothing }
}

/// A name as it is inserted in a script
fn insert_text(name: &str) -> Arc<str> {
    // Salesforce-style names keep their case, they scan fine without quotes
    let plain = name.bytes().enumerate().all(|(i, c)| c.is_ascii_alphabetic() || c == b'_' || (i > 0 && c.is_ascii_digit()));
    if plain { Arc::from(name) } else { Arc::from(quote_identifier(name)) }
}

/// The candidates at a cursor
struct Candidates {
    /// The typed prefix in lower case
    prefix: String,
    /// The text range that a candidate replaces
    target: SymbolSpan,
    /// The candidates
    out: Vec<Candidate>,
}

impl Candidates {
    /// Add a candidate if it matches the prefix, the bonus ranks the candidates that match equally well
    fn add(&mut self, name: &str, bonus: Score) {
        let lower = name.to_ascii_lowercase();
        let (tags, bonus): (CandidateTags, Score) = if self.prefix.is_empty() || lower.starts_with(&self.prefix) {
            (CandidateTag::PREFIX_MATCH.0, bonus + PREFIX_BONUS)
        } else if lower.contains(&self.prefix) {
            (CandidateTag::SUBSTRING_MATCH.0, bonus)
        } else {
            return;
        };
        let mut candidate = Candidate::new(insert_text(name), 0, tags, self.target, self.target);
        candidate.completion_text_is_verbatim = true;
        candidate.score = bonus;
        self.out.push(candidate);
    }

    /// The top k candidates: by score, then by name
    fn finish(mut self, k: usize) -> Vec<Candidate> {
        self.out.sort_by(|l, r| r.score.cmp(&l.score).then_with(|| l.completion_text.cmp(&r.completion_text)));
        self.out.truncate(k);
        self.out
    }
}

/// Complete at a cursor in a `CALL` of a namespace with client functions. Returns false if the cursor is elsewhere, or in a
/// query inside the call, which core SQL completes.
pub(crate) fn complete_client_function_call(completion: &mut Completion, k: usize) -> bool {
    let specs = completion.catalog();
    if specs.client_function_specs().is_empty() {
        return false;
    }
    let symbols = completion.symbols();
    let offset = completion.cursor.text_offset as u32;
    // The tokens that end before the cursor, and the name that the cursor is in or right behind
    let before = symbols
        .iter()
        .take_while(|s| s.kind != S_YYEOF && s.location.offset + s.location.length <= offset)
        .count();
    let containing = symbols.get(before).filter(|s| s.location.offset < offset && s.kind != S_YYEOF);
    if containing.is_some_and(|s| !is_name(s.kind)) {
        return false;
    }
    let (end, target) = match (containing, before.checked_sub(1).map(|i| &symbols[i])) {
        (Some(symbol), _) => (before, Some(symbol)),
        // Right behind a name
        (None, Some(previous)) if is_name(previous.kind) && previous.location.offset + previous.location.length == offset => {
            (before - 1, Some(previous))
        }
        _ => (before, None),
    };
    let statement_begin = symbols[..end].iter().rposition(|s| s.kind == S_SEMICOLON).map_or(0, |i| i + 1);
    let position = find_position(completion, specs, &symbols[statement_begin..end]);
    let (prefix, span) = match target {
        Some(symbol) => {
            let length = offset.saturating_sub(symbol.location.offset);
            let typed = completion.text_at(symbol.location.offset, length);
            let prefix = String::from_utf8_lossy(typed).trim_matches('"').to_ascii_lowercase();
            (prefix, SymbolSpan::new(symbol.location.offset, symbol.location.length))
        }
        None => (String::new(), SymbolSpan::new(offset, 0)),
    };
    let mut candidates = Candidates { prefix, target: span, out: Vec::new() };
    match position {
        Position::Outside => return false,
        Position::Nothing => {}
        // A procedure of the backend is possible as well, core SQL completes it if no namespace matches
        Position::Namespace => {
            for namespace in specs.client_function_specs().keys() {
                candidates.add(namespace, 0);
            }
            if candidates.out.is_empty() {
                return false;
            }
        }
        Position::Function(spec) => {
            for function in &spec.functions {
                candidates.add(&function.name, 0);
            }
        }
        Position::Key(spec, scope) => {
            let free_form = match scope.frame {
                Frame::Fields(None) => true,
                Frame::Fields(Some(schema)) => schema.attributes.is_empty() && schema.unknown == ClientFunctionUnknownPolicy::Allow,
                _ => false,
            };
            if !free_form {
                let used = |name: &str| scope.used.iter().any(|u| u.name.eq_ignore_ascii_case(name));
                for (attribute, required) in scope.attributes(spec).into_iter().filter(|(a, _)| !used(&a.name)) {
                    candidates.add(&attribute.name, if required { REQUIRED_BONUS } else { SPEC_OPTION_BONUS });
                }
                if let Frame::Options(function) = scope.frame {
                    for option in function.standard_options(spec).iter().filter(|o| !used(o)) {
                        candidates.add(option, 0);
                    }
                }
            }
        }
    }
    completion.top_candidates = candidates.finish(k);
    true
}
