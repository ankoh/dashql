//! Calls in a namespace with client functions: check a `CALL` against the signature of its function, and describe it for the
//! runtime of the host.
//!
//! `CALL` is a generic statement. A spec shadows its namespace on a connection, every other call goes to the backend as
//! written and the checks don't apply to it. They walk the value of the script, so recursive schemas need no care. See
//! `docs/design/client_functions.md`.

use super::state::AnalysisState;
use super::AnalyzedScript;
use crate::catalog::clfn::*;
use crate::catalog::{ClientFunctionSpec, CatalogSnapshot};
use crate::utils::unquote_string_literal;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::{AttributeKey as K, Node, NodeType};
use dashql_parser::attrs;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;
use dashql_parser::scanner::{ScannedScript, Symbol};
use dashql_parser::symbol_kind::*;
use serde_json::{json, Map, Number, Value};
use std::sync::Arc;

/// A `CALL` in a namespace with client functions, it never reaches the backend
#[derive(Clone, Debug)]
pub struct ClientFunctionCall {
    /// The statement
    pub ast_statement_id: u32,
    /// The call, the root of the statement or the body of its EXPLAIN
    pub ast_node_id: u32,
    /// Prints the request, sends nothing?
    pub explain: bool,
    /// The namespace
    pub namespace: Arc<str>,
    /// The function, None if the spec does not know it
    pub function: Option<Arc<str>>,
    /// The effect of the function, a write if it is unknown
    pub effect: ClientFunctionEffect,
}

impl ClientFunctionCall {
    /// Can another script read the result? A call of a known function that reads, not its EXPLAIN.
    pub fn readable(&self) -> bool {
        !self.explain && self.function.is_some() && self.effect == ClientFunctionEffect::Read
    }
}

/// Does a statement start with a call in a namespace with client functions? This comes from the tokens, so it also holds
/// for a call that doesn't parse, which the analysis never sees. A host that sends text to a backend asks this first.
/// An EXPLAIN may put anything before the call: `EXPLAIN (analyze) CALL` doesn't parse, and no backend may get it either.
pub fn starts_client_function_call(scanned: &ScannedScript, catalog: &CatalogSnapshot) -> bool {
    let starts_call = |symbols: &[Symbol]| {
        let [call, namespace, dot, ..] = symbols else { return false };
        if call.kind != S_CALL_P || (dot.kind != S_DOT && dot.kind != S_DOT_TRAILING) {
            return false;
        }
        let location = namespace.location;
        let name = &scanned.text.as_bytes()[location.offset as usize..(location.offset + location.length) as usize];
        catalog.client_function_spec(&String::from_utf8_lossy(name).trim_matches('"').to_ascii_lowercase()).is_some()
    };
    scanned.symbols.split(|symbol| symbol.kind == S_SEMICOLON).any(|statement| match statement.split_first() {
        Some((first, rest)) if first.kind == S_EXPLAIN => (0..rest.len()).any(|i| starts_call(&rest[i..])),
        _ => starts_call(statement),
    })
}

/// The call of a statement: the root or the body of an EXPLAIN
fn call_of_statement(parsed: &ParsedScript, root: u32) -> Option<(u32, bool)> {
    let node = &parsed.nodes[root as usize];
    match node.node_type() {
        NodeType::OBJECT_SQL_CALL => Some((root, false)),
        NodeType::OBJECT_EXT_EXPLAIN => {
            let [body] = attrs!(parsed.children(node), [K::EXT_EXPLAIN_STATEMENT]);
            let body = body?;
            (body.node_type() == NodeType::OBJECT_SQL_CALL).then(|| (node_id(parsed, body), true))
        }
        _ => None,
    }
}

fn node_id(parsed: &ParsedScript, node: &Node) -> u32 {
    ((node as *const Node as usize - parsed.nodes.as_ptr() as usize) / std::mem::size_of::<Node>()) as u32
}

/// The source text of a node
fn source<'a>(parsed: &'a ParsedScript, node: &Node) -> &'a str {
    let scanned = &parsed.scanned;
    let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
    let begin = (span.offset as usize).min(scanned.text.len());
    let end = (begin + span.length as usize).min(scanned.text.len());
    &scanned.text[begin..end]
}

/// A name in a script, a key of an option or attribute
struct KeyName {
    /// The spelling in the script, without the quotes
    text: String,
    /// Was it quoted? A quoted name means what it says.
    quoted: bool,
}

/// Read a key: a name or a string
fn read_key(parsed: &ParsedScript, key: &Node) -> KeyName {
    let text = source(parsed, key);
    if key.node_type() == NodeType::LITERAL_STRING {
        return KeyName { text: unquote_string_literal(text).unwrap_or_else(|| text.to_string()), quoted: true };
    }
    match text.as_bytes().first() {
        Some(&quote @ (b'"' | b'`')) if text.len() >= 2 => {
            let quote = quote as char;
            let inner = &text[1..text.len() - 1];
            KeyName { text: inner.replace(&format!("{quote}{quote}"), &quote.to_string()), quoted: true }
        }
        _ => KeyName { text: text.to_string(), quoted: false },
    }
}

/// The segments of a call name, without trailing dots. Unquoted names are lower case already.
fn read_name_path(parsed: &ParsedScript, name: &Node) -> Vec<String> {
    parsed
        .children(name)
        .iter()
        .filter(|c| c.node_type() == NodeType::NAME)
        .map(|c| {
            let key = read_key(parsed, c);
            if key.quoted { key.text } else { key.text.to_ascii_lowercase() }
        })
        .collect()
}

/// The function that a call name selects
struct Callee<'a> {
    namespace: &'a Arc<str>,
    spec: &'a ClientFunctionSpec,
    /// What follows the namespace
    path: Vec<String>,
}

fn resolve_callee<'a>(parsed: &ParsedScript, specs: &'a CatalogSnapshot, call: &Node) -> Option<Callee<'a>> {
    let [name] = attrs!(parsed.children(call), [K::SQL_CALL_NAME]);
    let mut path = read_name_path(parsed, name?).into_iter();
    // A namespace is a plain lower-case name, also if a script quotes it, like `starts_client_function_call` and completion read it
    let namespace = path.next()?.to_ascii_lowercase();
    let (namespace, spec) = specs.client_function_specs().get_key_value(namespace.as_str())?;
    Some(Callee { namespace, spec, path: path.collect() })
}

/// The fields of an object: the key and value of every field
fn fields_of<'p>(parsed: &'p ParsedScript, object: &Node) -> Vec<(&'p Node, &'p Node)> {
    parsed
        .children(object)
        .iter()
        .filter_map(|field| {
            let [key, value] = attrs!(parsed.children(field), [K::EXT_VARARG_FIELD_KEY, K::EXT_VARARG_FIELD_VALUE]);
            Some((key?, value?))
        })
        .collect()
}

/// Is the `method` option of a call of the escape hatch the string literal GET?
fn raw_method_is_get(parsed: &ParsedScript, args: Option<&Node>) -> bool {
    args.map(|a| parsed.children(a)).unwrap_or(&[]).iter().any(|arg| {
        let [key, value] = attrs!(parsed.children(arg), [K::SQL_FUNCTION_ARG_NAME, K::SQL_FUNCTION_ARG_VALUE]);
        let (Some(key), Some(value)) = (key, value) else { return false };
        let name = read_key(parsed, key);
        let is_method = if name.quoted { name.text == "method" } else { name.text.eq_ignore_ascii_case("method") };
        is_method && value.node_type() == NodeType::LITERAL_STRING && string_text(source(parsed, value)).eq_ignore_ascii_case("GET")
    })
}

/// A field as it decides the variant of a union
fn read_field(parsed: &ParsedScript, key: &Node, value: &Node) -> ClientFunctionField {
    let name = read_key(parsed, key);
    let text = (value.node_type() == NodeType::LITERAL_STRING).then(|| string_text(source(parsed, value)));
    ClientFunctionField { name: name.text, quoted: name.quoted, text }
}

/// Add a suggestion to a message
fn with_suggestion(message: String, suggestion: Option<&str>) -> String {
    match suggestion {
        Some(name) => format!("{message}, did you mean {name}?"),
        None => message,
    }
}

/// Check the calls of a script and record those in a namespace with a spec
pub(super) fn analyze(state: &mut AnalysisState) {
    let parsed = state.parsed;
    let snapshot = state.out.snapshot.clone();
    if snapshot.client_function_specs().is_empty() {
        return;
    }
    for (statement_id, statement) in parsed.statements.iter().enumerate() {
        let Some((call_id, explain)) = call_of_statement(parsed, statement.root) else { continue };
        let call = &parsed.nodes[call_id as usize];
        let Some(callee) = resolve_callee(parsed, &snapshot, call) else { continue };
        let [name, args] = attrs!(parsed.children(call), [K::SQL_CALL_NAME, K::SQL_CALL_ARGS]);
        let name_id = name.map(|n| node_id(parsed, n)).unwrap_or(call_id);
        let spec = callee.spec;
        let function = match callee.path.as_slice() {
            [function_name] => spec.function(function_name),
            _ => None,
        };
        match function {
            Some(function) => Checker { state, spec, function }.check_options(args, call_id),
            // A name that is still typed, the parser reports the trailing dot
            None if callee.path.is_empty() => {}
            // The spec shadows its namespace, the backend never gets this call
            None => {
                let function_name = callee.path.join(".");
                let suggestion = closest_name(&function_name, spec.functions.iter().map(|f| f.name.as_str()));
                let message = with_suggestion(format!("unknown function {}.{function_name}", callee.namespace), suggestion);
                state.add_error(AnalyzerErrorType::CLIENT_FUNCTION_UNKNOWN_FUNCTION, AnalyzerErrorSeverity::ERROR, name_id, message);
            }
        }
        state.out.client_function_calls.push(ClientFunctionCall {
            ast_statement_id: statement_id as u32,
            ast_node_id: call_id,
            explain,
            namespace: callee.namespace.clone(),
            function: function.map(|f| Arc::from(f.name.as_str())),
            effect: match function {
                // The escape hatch reads if its method is the literal GET
                Some(function) if function.raw && raw_method_is_get(parsed, args) => ClientFunctionEffect::Read,
                Some(function) => function.effect(),
                None => ClientFunctionEffect::Write,
            },
        });
    }
}

/// The checks of the call of one function
struct Checker<'s, 'a, 'c> {
    state: &'s mut AnalysisState<'a>,
    spec: &'c ClientFunctionSpec,
    function: &'c ClientFunction,
}

impl Checker<'_, '_, '_> {
    fn error(&mut self, error_type: AnalyzerErrorType, node: &Node, message: String) {
        let id = node_id(self.state.parsed, node);
        self.state.add_error(error_type, AnalyzerErrorSeverity::ERROR, id, message);
    }

    /// Check the options of the call
    fn check_options(&mut self, args: Option<&Node>, call_id: u32) {
        let parsed = self.state.parsed;
        let function = self.function;
        let mut seen: Vec<Arc<str>> = Vec::new();
        let args: &[Node] = args.map(|a| parsed.children(a)).unwrap_or(&[]);
        let standard = function.standard_options(self.spec);
        let mut used_standard: Vec<&str> = Vec::new();
        for arg in args {
            let [key, value] = attrs!(parsed.children(arg), [K::SQL_FUNCTION_ARG_NAME, K::SQL_FUNCTION_ARG_VALUE]);
            let (Some(key), Some(value)) = (key, value) else { continue };
            let name = read_key(parsed, key);
            // The standard options are not sent, the runtime applies them
            if !name.quoted && name.text.starts_with('_') {
                let lower = name.text.to_ascii_lowercase();
                match standard.iter().find(|s| **s == lower) {
                    Some(&option) => {
                        if used_standard.contains(&option) {
                            self.error(AnalyzerErrorType::CLIENT_FUNCTION_DUPLICATE_OPTION, key, format!("duplicate option {option}"));
                        }
                        used_standard.push(option);
                        self.check_standard_value(option, value);
                    }
                    None => {
                        let message = format!("{}.{} has no option {}", self.spec.namespace, function.name, name.text);
                        self.error(AnalyzerErrorType::CLIENT_FUNCTION_UNSUPPORTED_OPTION, key, message);
                    }
                }
                continue;
            }
            let attribute = find_attribute(&function.options, &name.text, name.quoted);
            let canonical: Arc<str> = Arc::from(attribute.map_or(name.text.as_str(), |a| a.name.as_str()));
            if seen.contains(&canonical) {
                self.error(AnalyzerErrorType::CLIENT_FUNCTION_DUPLICATE_OPTION, key, format!("duplicate option {canonical}"));
            }
            seen.push(canonical);
            if attribute.is_none() && !name.quoted {
                let suggestion = closest_name(&name.text, function.options.iter().map(|o| o.name.as_str()));
                let message = format!("{}.{} has no option {}", self.spec.namespace, function.name, name.text);
                self.report_unknown(function.unknown_options(), key, with_suggestion(message, suggestion));
            }
            self.check_value(value, attribute);
        }
        // `_next` sets an option of the function
        let paging = function.paging.as_ref();
        if used_standard.contains(&OPTION_NEXT) {
            if let Some(option) = paging.and_then(|p| p.option.as_ref()).filter(|o| seen.iter().any(|s| **s == ***o)) {
                let call = &parsed.nodes[call_id as usize];
                let message = format!("{OPTION_NEXT} sets the option {option}, use one of them");
                self.error(AnalyzerErrorType::CLIENT_FUNCTION_DUPLICATE_OPTION, call, message);
            }
        }
        if used_standard.contains(&OPTION_NEXT) && used_standard.contains(&OPTION_POLL) {
            let call = &parsed.nodes[call_id as usize];
            let message = format!("{OPTION_NEXT} and {OPTION_POLL} continue different things, use one of them");
            self.error(AnalyzerErrorType::CLIENT_FUNCTION_UNSUPPORTED_OPTION, call, message);
        }
        // A poll and a next URL carry the whole request
        let next_url = used_standard.contains(&OPTION_NEXT) && paging.is_some_and(|p| p.kind == "url");
        if !used_standard.contains(&OPTION_POLL) && !next_url {
            for option in function.options.iter().filter(|o| o.required) {
                if !seen.iter().any(|s| **s == *option.name) {
                    let call = &parsed.nodes[call_id as usize];
                    let message = format!("{}.{} needs the option {}", self.spec.namespace, function.name, option.name);
                    self.error(AnalyzerErrorType::CLIENT_FUNCTION_MISSING_OPTION, call, message);
                }
            }
        }
    }

    /// `_pages` takes a positive number, and `_wait` a number of seconds, which can be its default 0
    fn check_standard_value(&mut self, option: &str, value: &Node) {
        if !matches!(option, OPTION_PAGES | OPTION_WAIT) {
            return;
        }
        match value.node_type() {
            NodeType::OBJECT_SQL_PARAMETER_REF => {}
            NodeType::LITERAL_INTEGER if source(self.state.parsed, value).parse::<u64>().is_ok_and(|n| n > 0 || option == OPTION_WAIT) => {}
            _ => {
                let expected = if option == OPTION_WAIT { "a number of seconds" } else { "a positive number" };
                self.error(AnalyzerErrorType::CLIENT_FUNCTION_INVALID_VALUE, value, format!("{option} takes {expected}"));
            }
        }
    }

    fn report_unknown(&mut self, policy: ClientFunctionUnknownPolicy, node: &Node, message: String) {
        let severity = match policy {
            ClientFunctionUnknownPolicy::Error => AnalyzerErrorSeverity::ERROR,
            ClientFunctionUnknownPolicy::Warning => AnalyzerErrorSeverity::WARNING,
            ClientFunctionUnknownPolicy::Allow => return,
        };
        let id = node_id(self.state.parsed, node);
        self.state.add_error(AnalyzerErrorType::CLIENT_FUNCTION_UNKNOWN_OPTION, severity, id, message);
    }

    /// Check the value of an option or attribute
    fn check_value(&mut self, value: &Node, attribute: Option<&ClientFunctionAttribute>) {
        self.check_nested_value(value, attribute, attribute.is_some_and(|a| a.map));
    }

    /// Check a value. `map` says that an object is the map of the attribute: its keys are free, and the attribute holds for
    /// its values.
    fn check_nested_value(&mut self, value: &Node, attribute: Option<&ClientFunctionAttribute>, map: bool) {
        let parsed = self.state.parsed;
        match value.node_type() {
            NodeType::ARRAY if map => {
                let mut seen: Vec<KeyName> = Vec::new();
                for (key, item) in fields_of(parsed, value) {
                    let name = read_key(parsed, key);
                    if seen.iter().any(|s| s.text == name.text) {
                        self.error(AnalyzerErrorType::CLIENT_FUNCTION_DUPLICATE_OPTION, key, format!("duplicate key {}", name.text));
                    }
                    seen.push(name);
                    self.check_nested_value(item, attribute, false);
                }
            }
            // An object
            NodeType::ARRAY => {
                let spec = self.spec;
                let schema = attribute.and_then(|a| a.schema.as_ref()).and_then(|s| spec.schema(s));
                self.check_fields(value, schema);
            }
            NodeType::OBJECT_EXT_VARARG_ARRAY => {
                let [values] = attrs!(parsed.children(value), [K::EXT_VARARG_ARRAY_VALUES]);
                for item in values.map(|v| parsed.children(v)).unwrap_or(&[]) {
                    self.check_nested_value(item, attribute, map);
                }
            }
            NodeType::LITERAL_NULL
            | NodeType::LITERAL_INTEGER
            | NodeType::LITERAL_FLOAT
            | NodeType::LITERAL_STRING
            | NodeType::BOOL
            | NodeType::OBJECT_SQL_NARY_EXPRESSION
            | NodeType::OBJECT_SQL_PARAMETER_REF
            | NodeType::OBJECT_SQL_SELECT_EXPRESSION => {}
            // A function, such as now() or cast(...)
            _ => {
                let message = "a value can't call a function".to_string();
                self.error(AnalyzerErrorType::CLIENT_FUNCTION_INVALID_VALUE, value, message);
            }
        }
    }

    /// Check the fields of an object against its schema. Without a schema any key goes. An object of a union has to fit
    /// one variant.
    fn check_fields(&mut self, object: &Node, schema: Option<&ClientFunctionSchema>) {
        let parsed = self.state.parsed;
        let spec = self.spec;
        let fields = fields_of(parsed, object);
        let read: Vec<ClientFunctionField> = fields.iter().map(|(key, value)| read_field(parsed, key, value)).collect();
        let fit = schema.map(|s| spec.fit(s, &read));
        let mut seen: Vec<Arc<str>> = Vec::new();
        for (i, (key, value)) in fields.iter().copied().enumerate() {
            let name = &read[i];
            let attribute = schema.and_then(|s| spec.attribute_of(s, &name.name, name.quoted));
            let canonical: Arc<str> = Arc::from(attribute.map_or(name.name.as_str(), |a| a.name.as_str()));
            if seen.contains(&canonical) {
                self.error(AnalyzerErrorType::CLIENT_FUNCTION_DUPLICATE_OPTION, key, format!("duplicate attribute {canonical}"));
            }
            seen.push(canonical);
            if let Some(fit) = fit.as_ref() {
                if attribute.is_none() && !name.quoted {
                    let candidates = fit.variants.iter().flat_map(|v| v.attributes.iter()).map(|a| a.name.as_str());
                    let message = with_suggestion(format!("no attribute {} here", name.name), closest_name(&name.name, candidates));
                    self.report_unknown(fit.unknown(), key, message);
                } else if fit.conflicts.contains(&i) {
                    let message = match fit.tag_field.map(|t| &read[t]) {
                        Some(tag) => format!("no attribute {} when {} is '{}'", name.name, tag.name, tag.text.as_deref().unwrap_or_default()),
                        None => format!("{} does not fit the attributes before it", name.name),
                    };
                    self.report_unknown(fit.unknown(), key, message);
                }
            }
            self.check_value(value, attribute);
        }
        // An object only has to satisfy one variant, the closest ones say what is missing
        let missing: Vec<Vec<&str>> = fit
            .iter()
            .flat_map(|f| f.variants.iter())
            .map(|variant| {
                let is_missing = |a: &&ClientFunctionAttribute| a.required && !seen.iter().any(|s| **s == *a.name);
                variant.attributes.iter().filter(is_missing).map(|a| a.name.as_str()).collect()
            })
            .collect();
        let fewest = missing.iter().map(Vec::len).min().unwrap_or(0);
        if fewest == 0 {
            return;
        }
        let closest: Vec<&Vec<&str>> = missing.iter().filter(|m| m.len() == fewest).collect();
        // What all of them need is certain, the rest is a choice between them
        let needed_by_all = |name: &str| closest.iter().all(|m| m.contains(&name));
        for name in closest[0].iter().copied().filter(|name| needed_by_all(name)) {
            self.error(AnalyzerErrorType::CLIENT_FUNCTION_MISSING_OPTION, object, format!("needs the attribute {name}"));
        }
        let mut choice: Vec<&str> = closest.iter().flat_map(|m| m.iter().copied()).filter(|name| !needed_by_all(name)).collect();
        choice.sort_unstable();
        choice.dedup();
        if !choice.is_empty() {
            let message = format!("needs one of the attributes {}", choice.join(", "));
            self.error(AnalyzerErrorType::CLIENT_FUNCTION_MISSING_OPTION, object, message);
        }
    }
}

// -------------------------------------------------------------------------------------------------
// The description of a call
// -------------------------------------------------------------------------------------------------

/// A value that the runtime fills in: a JSON pointer into the options and a parameter
fn binding(pointer: String, name: String) -> Value {
    json!({ "pointer": pointer, "param": name })
}

/// A segment of a JSON pointer
fn pointer_segment(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// Does a parenthesis around all of these tokens match? A query can start and end with parentheses of its own, as in
/// `(select 1) union (select 2)`.
fn is_parenthesized(symbols: &[Symbol]) -> bool {
    if symbols.first().is_none_or(|s| s.kind != S_LRB) {
        return false;
    }
    let mut depth = 0;
    for (i, symbol) in symbols.iter().enumerate() {
        match symbol.kind {
            S_LRB => depth += 1,
            S_RRB => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            return i + 1 == symbols.len();
        }
    }
    false
}

/// The SQL text of a query value, without the parentheses around it. The tokens tell, since a string can hold a parenthesis.
fn select_text<'a>(parsed: &'a ParsedScript, node: &Node) -> &'a str {
    let scanned = &parsed.scanned;
    let span = node.symbol_span();
    let mut symbols = &scanned.symbols[span.offset() as usize..(span.offset() + span.length()) as usize];
    while is_parenthesized(symbols) {
        symbols = &symbols[1..symbols.len() - 1];
    }
    match (symbols.first(), symbols.last()) {
        (Some(first), Some(last)) => &scanned.text[first.location.offset as usize..last.location.end() as usize],
        _ => "",
    }
}

/// The number of a literal, as exact as JSON allows
pub(crate) fn number(text: &str) -> Value {
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    if let Ok(n) = compact.parse::<i64>() {
        return Value::Number(n.into());
    }
    if let Ok(n) = compact.parse::<u64>() {
        return Value::Number(n.into());
    }
    compact.parse::<f64>().ok().and_then(Number::from_f64).map(Value::Number).unwrap_or(Value::Null)
}

/// The text of a string literal
fn string_text(text: &str) -> String {
    if let Some(inner) = text.strip_prefix("$$").and_then(|t| t.strip_suffix("$$")) {
        return inner.to_string();
    }
    unquote_string_literal(text).unwrap_or_else(|| text.to_string())
}

struct Describer<'a> {
    analyzed: &'a AnalyzedScript,
    spec: &'a ClientFunctionSpec,
    bindings: Vec<Value>,
}

impl Describer<'_> {
    /// The value of an option or attribute
    fn value(&mut self, node: &Node, attribute: Option<&ClientFunctionAttribute>, pointer: &str) -> Value {
        self.nested_value(node, attribute, attribute.is_some_and(|a| a.map), pointer)
    }

    /// The value of a node, a parameter leaves a null and a binding. `map` says that an object is the map of the attribute:
    /// its keys stay as written, and the attribute holds for its values.
    fn nested_value(&mut self, node: &Node, attribute: Option<&ClientFunctionAttribute>, map: bool, pointer: &str) -> Value {
        let parsed = self.analyzed.parsed.clone();
        let text = source(&parsed, node);
        match node.node_type() {
            NodeType::LITERAL_NULL => Value::Null,
            NodeType::BOOL => Value::Bool(node.children_begin_or_value() != 0),
            NodeType::LITERAL_INTEGER | NodeType::LITERAL_FLOAT | NodeType::OBJECT_SQL_NARY_EXPRESSION => number(text),
            NodeType::LITERAL_STRING => Value::String(string_text(text)),
            NodeType::OBJECT_SQL_SELECT_EXPRESSION => Value::String(select_text(&parsed, node).to_string()),
            NodeType::OBJECT_SQL_PARAMETER_REF => {
                let id = node_id(&parsed, node);
                let name = self.analyzed.parameters.iter().find(|p| p.ast_node_id == id).and_then(|p| p.name.clone());
                self.bindings.push(binding(pointer.to_string(), name.as_deref().unwrap_or("").to_string()));
                Value::Null
            }
            NodeType::OBJECT_EXT_VARARG_ARRAY => {
                let [values] = attrs!(parsed.children(node), [K::EXT_VARARG_ARRAY_VALUES]);
                let items = values.map(|v| parsed.children(v)).unwrap_or(&[]);
                Value::Array(items.iter().enumerate().map(|(i, item)| self.nested_value(item, attribute, map, &format!("{pointer}/{i}"))).collect())
            }
            NodeType::ARRAY => {
                let spec = self.spec;
                let schema = attribute.and_then(|a| a.schema.as_ref()).and_then(|s| spec.schema(s));
                let mut object = Map::new();
                for (key, value) in fields_of(&parsed, node) {
                    let name = read_key(&parsed, key);
                    if map {
                        let field_pointer = format!("{pointer}/{}", pointer_segment(&name.text));
                        let field_value = self.nested_value(value, attribute, false, &field_pointer);
                        object.insert(name.text, field_value);
                        continue;
                    }
                    let field_attribute = schema.and_then(|s| spec.attribute_of(s, &name.text, name.quoted));
                    let field_name = field_attribute.map_or(name.text, |a| a.name.clone());
                    let field_pointer = format!("{pointer}/{}", pointer_segment(&field_name));
                    let field_value = self.value(value, field_attribute, &field_pointer);
                    object.insert(field_name, field_value);
                }
                Value::Object(object)
            }
            _ => Value::Null,
        }
    }
}

impl AnalyzedScript {
    /// Does the script call a client function that writes? A call of an unknown function counts as one, its EXPLAIN
    /// sends nothing. Such a script runs only on request, like one with a `@manual` tag.
    pub fn calls_writes(&self) -> bool {
        self.client_function_calls.iter().any(|c| !c.explain && c.effect == ClientFunctionEffect::Write)
    }

    /// The call of a script that is a single call in a namespace with client functions
    pub fn single_client_function_call(&self) -> Option<&ClientFunctionCall> {
        match &self.parsed.statements[..] {
            [_] => self.client_function_calls.iter().find(|c| c.ast_statement_id == 0),
            _ => None,
        }
    }

    /// The result columns of a call of a known function, in the order of the runtime
    pub fn client_function_result_columns(&self, call: &ClientFunctionCall) -> Option<Vec<Arc<str>>> {
        let spec = self.snapshot.client_function_spec(&call.namespace)?;
        let function = spec.function(call.function.as_deref()?)?;
        Some(spec.result_columns(function).into_iter().map(Arc::from).collect())
    }

    /// Describe a `CALL` of a function of a spec for the runtime of the host: plain JSON over the names of the spec.
    /// A known name has the spelling of the spec, any other the spelling of the script. Strings are unescaped, and a
    /// parameter is a null with an entry in `bindings`. None for any other statement.
    pub fn describe_client_function_call(&self, statement_id: u32) -> Option<Value> {
        let record = self.client_function_calls.iter().find(|c| c.ast_statement_id == statement_id)?;
        let function_name = record.function.as_ref()?;
        let spec = self.snapshot.client_function_spec(&record.namespace)?;
        let function = spec.function(function_name)?;
        let parsed = self.parsed.clone();
        let call = &parsed.nodes[record.ast_node_id as usize];
        let [args] = attrs!(parsed.children(call), [K::SQL_CALL_ARGS]);
        let mut describer = Describer { analyzed: self, spec, bindings: Vec::new() };
        let mut options = Map::new();
        for arg in args.map(|a| parsed.children(a)).unwrap_or(&[]) {
            let [key, value] = attrs!(parsed.children(arg), [K::SQL_FUNCTION_ARG_NAME, K::SQL_FUNCTION_ARG_VALUE]);
            let (Some(key), Some(value)) = (key, value) else { continue };
            let name = read_key(&parsed, key);
            let attribute = find_attribute(&function.options, &name.text, name.quoted);
            let option_name = match attribute {
                Some(attribute) => attribute.name.clone(),
                // The standard options fold their case like any other known name
                None if !name.quoted && name.text.starts_with('_') => name.text.to_ascii_lowercase(),
                None => name.text,
            };
            let pointer = format!("/{}", pointer_segment(&option_name));
            let described = describer.value(value, attribute, &pointer);
            options.insert(option_name, described);
        }
        let mut out = json!({
            "namespace": &*record.namespace,
            "function": &**function_name,
            "effect": if record.effect == ClientFunctionEffect::Read { "read" } else { "write" },
            "explain": record.explain,
            "options": options,
        });
        if !describer.bindings.is_empty() {
            out["bindings"] = Value::Array(describer.bindings);
        }
        Some(out)
    }
}
