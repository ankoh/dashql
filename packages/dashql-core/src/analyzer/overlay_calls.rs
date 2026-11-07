//! Calls in a namespace with an overlay: check a `CALL` against the signature of its function, and describe it for the
//! runtime of the host.
//!
//! `CALL` is a generic statement. A spec shadows its namespace on a connection, every other call goes to the backend as
//! written and the checks don't apply to it. They walk the value of the script, so recursive schemas need no care. See
//! `docs/design/overlay.md`.

use super::state::AnalysisState;
use super::AnalyzedScript;
use crate::catalog::overlay::*;
use crate::catalog::{OverlaySpec, CatalogSnapshot};
use crate::utils::unquote_string_literal;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::{AttributeKey as K, Node, NodeType};
use dashql_parser::attrs;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;
use serde_json::{json, Map, Number, Value};
use std::sync::Arc;

/// A `CALL` in a namespace with an overlay, it never reaches the backend
#[derive(Clone, Debug)]
pub struct OverlayCall {
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
    pub effect: OverlayEffect,
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
    spec: &'a OverlaySpec,
    /// What follows the namespace
    path: Vec<String>,
}

fn resolve_callee<'a>(parsed: &ParsedScript, specs: &'a CatalogSnapshot, call: &Node) -> Option<Callee<'a>> {
    let [name] = attrs!(parsed.children(call), [K::SQL_CALL_NAME]);
    let mut path = read_name_path(parsed, name?).into_iter();
    let (namespace, spec) = specs.overlays().get_key_value(path.next()?.as_str())?;
    Some(Callee { namespace, spec, path: path.collect() })
}

/// Is a function expression a `secret(<name>)`? Returns the name.
fn read_secret(parsed: &ParsedScript, function: &Node) -> Option<String> {
    let [name, args] = attrs!(parsed.children(function), [K::SQL_FUNCTION_NAME, K::SQL_FUNCTION_ARGUMENTS]);
    let path = read_name_path(parsed, name.filter(|n| n.node_type() == NodeType::ARRAY)?);
    if path.len() != 1 || path[0] != "secret" {
        return None;
    }
    let args = parsed.children(args?);
    let [arg] = args else { return None };
    // A named argument is no secret name
    let value = if arg.node_type() == NodeType::OBJECT_SQL_FUNCTION_ARG {
        let [name, value] = attrs!(parsed.children(arg), [K::SQL_FUNCTION_ARG_NAME, K::SQL_FUNCTION_ARG_VALUE]);
        if name.is_some() {
            return None;
        }
        value?
    } else {
        arg
    };
    match value.node_type() {
        NodeType::LITERAL_STRING => unquote_string_literal(source(parsed, value)),
        NodeType::OBJECT_SQL_COLUMN_REF => {
            let [path] = attrs!(parsed.children(value), [K::SQL_COLUMN_REF_PATH]);
            let path = path?;
            let [name] = parsed.children(path) else { return None };
            Some(read_key(parsed, name).text)
        }
        _ => None,
    }
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
    if snapshot.overlays().is_empty() {
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
                state.add_error(AnalyzerErrorType::OVERLAY_UNKNOWN_FUNCTION, AnalyzerErrorSeverity::ERROR, name_id, message);
            }
        }
        state.out.overlay_calls.push(OverlayCall {
            ast_statement_id: statement_id as u32,
            ast_node_id: call_id,
            explain,
            namespace: callee.namespace.clone(),
            function: function.map(|f| Arc::from(f.name.as_str())),
            effect: function.map_or(OverlayEffect::Write, OverlayFunction::effect),
        });
    }
}

/// The checks of the call of one function
struct Checker<'s, 'a, 'c> {
    state: &'s mut AnalysisState<'a>,
    spec: &'c OverlaySpec,
    function: &'c OverlayFunction,
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
                            self.error(AnalyzerErrorType::OVERLAY_DUPLICATE_OPTION, key, format!("duplicate option {option}"));
                        }
                        used_standard.push(option);
                        self.check_standard_value(option, value);
                    }
                    None => {
                        let message = format!("{}.{} has no option {}", self.spec.namespace, function.name, name.text);
                        self.error(AnalyzerErrorType::OVERLAY_UNSUPPORTED_OPTION, key, message);
                    }
                }
                continue;
            }
            let attribute = find_attribute(&function.options, &name.text, name.quoted);
            let canonical: Arc<str> = Arc::from(attribute.map_or(name.text.as_str(), |a| a.name.as_str()));
            if seen.contains(&canonical) {
                self.error(AnalyzerErrorType::OVERLAY_DUPLICATE_OPTION, key, format!("duplicate option {canonical}"));
            }
            seen.push(canonical.clone());
            if attribute.is_none() && !name.quoted {
                let suggestion = closest_name(&name.text, function.options.iter().map(|o| o.name.as_str()));
                let message = format!("{}.{} has no option {}", self.spec.namespace, function.name, name.text);
                self.report_unknown(function.unknown_options(), key, with_suggestion(message, suggestion));
            }
            let mut path = vec![canonical];
            self.check_value(value, attribute, &mut path, &[]);
        }
        // `_next` sets an option of the function
        let paging = function.paging.as_ref();
        if used_standard.contains(&OPTION_NEXT) {
            if let Some(option) = paging.and_then(|p| p.option.as_ref()).filter(|o| seen.iter().any(|s| **s == ***o)) {
                let call = &parsed.nodes[call_id as usize];
                let message = format!("{OPTION_NEXT} sets the option {option}, use one of them");
                self.error(AnalyzerErrorType::OVERLAY_DUPLICATE_OPTION, call, message);
            }
        }
        if used_standard.contains(&OPTION_NEXT) && used_standard.contains(&OPTION_POLL) {
            let call = &parsed.nodes[call_id as usize];
            let message = format!("{OPTION_NEXT} and {OPTION_POLL} continue different things, use one of them");
            self.error(AnalyzerErrorType::OVERLAY_UNSUPPORTED_OPTION, call, message);
        }
        // A poll and a next URL carry the whole request
        let next_url = used_standard.contains(&OPTION_NEXT) && paging.is_some_and(|p| p.kind == "url");
        if !used_standard.contains(&OPTION_POLL) && !next_url {
            for option in function.options.iter().filter(|o| o.required) {
                if !seen.iter().any(|s| **s == *option.name) {
                    let call = &parsed.nodes[call_id as usize];
                    let message = format!("{}.{} needs the option {}", self.spec.namespace, function.name, option.name);
                    self.error(AnalyzerErrorType::OVERLAY_MISSING_OPTION, call, message);
                }
            }
        }
    }

    /// `_pages` and `_wait` take a positive number
    fn check_standard_value(&mut self, option: &str, value: &Node) {
        if !matches!(option, OPTION_PAGES | OPTION_WAIT) {
            return;
        }
        match value.node_type() {
            NodeType::OBJECT_SQL_PARAMETER_REF => {}
            NodeType::LITERAL_INTEGER if source(self.state.parsed, value).parse::<u64>().is_ok_and(|n| n > 0) => {}
            _ => {
                self.error(AnalyzerErrorType::OVERLAY_INVALID_VALUE, value, format!("{option} takes a positive number"));
            }
        }
    }

    fn report_unknown(&mut self, policy: OverlayUnknownPolicy, node: &Node, message: String) {
        let severity = match policy {
            OverlayUnknownPolicy::Error => AnalyzerErrorSeverity::ERROR,
            OverlayUnknownPolicy::Warning => AnalyzerErrorSeverity::WARNING,
            OverlayUnknownPolicy::Allow => return,
        };
        let id = node_id(self.state.parsed, node);
        self.state.add_error(AnalyzerErrorType::OVERLAY_UNKNOWN_OPTION, severity, id, message);
    }

    /// Is the value public because of a sibling?
    fn is_public(&self, sensitive: &OverlaySensitive, siblings: &[(&Node, &Node)]) -> bool {
        let parsed = self.state.parsed;
        sensitive.public_when.iter().any(|(attribute, values)| {
            siblings.iter().any(|(key, value)| {
                read_key(parsed, key).text.eq_ignore_ascii_case(attribute)
                    && value.node_type() == NodeType::LITERAL_STRING
                    && unquote_string_literal(source(parsed, value)).is_some_and(|v| values.contains(&v))
            })
        })
    }

    /// Check a value at a path
    fn check_value(&mut self, value: &Node, attribute: Option<&OverlayAttribute>, path: &mut Vec<Arc<str>>, siblings: &[(&Node, &Node)]) {
        let parsed = self.state.parsed;
        let secret = (value.node_type() == NodeType::OBJECT_SQL_FUNCTION_EXPRESSION).then(|| read_secret(parsed, value)).flatten();
        let function = self.function;
        if secret.is_none() {
            if let Some(sensitive) = function.sensitive.iter().find(|s| s.matches(path)) {
                if !self.is_public(sensitive, siblings) {
                    let pointer: Vec<&str> = path.iter().map(|s| &**s).filter(|s| *s != "*").collect();
                    let message = format!("{} is sensitive, it must be a secret()", pointer.join("."));
                    self.error(AnalyzerErrorType::OVERLAY_SENSITIVE_VALUE, value, message);
                    return;
                }
            }
        }
        match value.node_type() {
            // An object
            NodeType::ARRAY => {
                let spec = self.spec;
                let schema = attribute.and_then(|a| a.schema.as_ref()).and_then(|s| spec.schema(s));
                self.check_fields(value, schema, path);
            }
            NodeType::OBJECT_EXT_VARARG_ARRAY => {
                let [values] = attrs!(parsed.children(value), [K::EXT_VARARG_ARRAY_VALUES]);
                path.push(Arc::from("*"));
                for item in values.map(|v| parsed.children(v)).unwrap_or(&[]) {
                    self.check_value(item, attribute, path, &[]);
                }
                path.pop();
            }
            NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                if secret.is_none() {
                    let message = "a value can only call secret(<name>)".to_string();
                    self.error(AnalyzerErrorType::OVERLAY_INVALID_VALUE, value, message);
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
            // The other function syntaxes, such as cast(...)
            _ => {
                let message = "a value can only call secret(<name>)".to_string();
                self.error(AnalyzerErrorType::OVERLAY_INVALID_VALUE, value, message);
            }
        }
    }

    /// Check the fields of an object against its schema. Without a schema any key goes.
    fn check_fields(&mut self, object: &Node, schema: Option<&OverlaySchema>, path: &mut Vec<Arc<str>>) {
        let parsed = self.state.parsed;
        let fields = fields_of(parsed, object);
        let mut seen: Vec<Arc<str>> = Vec::new();
        for (key, value) in fields.iter().copied() {
            let name = read_key(parsed, key);
            let attribute = schema.and_then(|s| find_attribute(&s.attributes, &name.text, name.quoted));
            let canonical: Arc<str> = Arc::from(attribute.map_or(name.text.as_str(), |a| a.name.as_str()));
            if seen.contains(&canonical) {
                self.error(AnalyzerErrorType::OVERLAY_DUPLICATE_OPTION, key, format!("duplicate attribute {canonical}"));
            }
            seen.push(canonical.clone());
            if let Some(schema) = schema.filter(|_| attribute.is_none() && !name.quoted) {
                let suggestion = closest_name(&name.text, schema.attributes.iter().map(|a| a.name.as_str()));
                let message = with_suggestion(format!("no attribute {} here", name.text), suggestion);
                self.report_unknown(schema.unknown, key, message);
            }
            path.push(canonical);
            self.check_value(value, attribute, path, &fields);
            path.pop();
        }
        for attribute in schema.iter().flat_map(|s| s.attributes.iter()).filter(|a| a.required) {
            if !seen.iter().any(|s| **s == *attribute.name) {
                self.error(AnalyzerErrorType::OVERLAY_MISSING_OPTION, object, format!("needs the attribute {}", attribute.name));
            }
        }
    }
}

// -------------------------------------------------------------------------------------------------
// The description of a call
// -------------------------------------------------------------------------------------------------

/// A value that the runtime fills in: a JSON pointer into the options, and a parameter or a secret
fn binding(pointer: String, kind: &str, name: String) -> Value {
    json!({ "pointer": pointer, kind: name })
}

/// A segment of a JSON pointer
fn pointer_segment(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// The SQL text of a query value, without the parentheses around it
fn select_text(text: &str) -> &str {
    let mut text = text.trim();
    while let Some(inner) = text.strip_prefix('(').and_then(|t| t.strip_suffix(')')) {
        text = inner.trim();
    }
    text
}

/// The number of a literal, as exact as JSON allows
fn number(text: &str) -> Value {
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
    spec: &'a OverlaySpec,
    bindings: Vec<Value>,
}

impl Describer<'_> {
    /// The value of a node, parameters and secrets leave a null and a binding
    fn value(&mut self, node: &Node, attribute: Option<&OverlayAttribute>, pointer: &str) -> Value {
        let parsed = self.analyzed.parsed.clone();
        let text = source(&parsed, node);
        match node.node_type() {
            NodeType::LITERAL_NULL => Value::Null,
            NodeType::BOOL => Value::Bool(node.children_begin_or_value() != 0),
            NodeType::LITERAL_INTEGER | NodeType::LITERAL_FLOAT | NodeType::OBJECT_SQL_NARY_EXPRESSION => number(text),
            NodeType::LITERAL_STRING => Value::String(string_text(text)),
            NodeType::OBJECT_SQL_SELECT_EXPRESSION => Value::String(select_text(text).to_string()),
            NodeType::OBJECT_SQL_PARAMETER_REF => {
                let id = node_id(&parsed, node);
                let name = self.analyzed.parameters.iter().find(|p| p.ast_node_id == id).and_then(|p| p.name.clone());
                self.bindings.push(binding(pointer.to_string(), "param", name.as_deref().unwrap_or("").to_string()));
                Value::Null
            }
            NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                if let Some(name) = read_secret(&parsed, node) {
                    self.bindings.push(binding(pointer.to_string(), "secret", name));
                }
                Value::Null
            }
            NodeType::OBJECT_EXT_VARARG_ARRAY => {
                let [values] = attrs!(parsed.children(node), [K::EXT_VARARG_ARRAY_VALUES]);
                let items = values.map(|v| parsed.children(v)).unwrap_or(&[]);
                Value::Array(
                    items.iter().enumerate().map(|(i, item)| self.value(item, attribute, &format!("{pointer}/{i}"))).collect(),
                )
            }
            NodeType::ARRAY => {
                let spec = self.spec;
                let schema = attribute.and_then(|a| a.schema.as_ref()).and_then(|s| spec.schema(s));
                let mut object = Map::new();
                for field in parsed.children(node) {
                    let [key, value] = attrs!(parsed.children(field), [K::EXT_VARARG_FIELD_KEY, K::EXT_VARARG_FIELD_VALUE]);
                    let (Some(key), Some(value)) = (key, value) else { continue };
                    let name = read_key(&parsed, key);
                    let field_attribute = schema.and_then(|s| find_attribute(&s.attributes, &name.text, name.quoted));
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
    /// Describe a `CALL` of a function of a spec for the runtime of the host: plain JSON over the names of the spec.
    /// A known name has the spelling of the spec, any other the spelling of the script. Strings are unescaped, and a
    /// parameter or a secret is a null with an entry in `bindings`. None for any other statement.
    pub fn describe_overlay_call(&self, statement_id: u32) -> Option<Value> {
        let record = self.overlay_calls.iter().find(|c| c.ast_statement_id == statement_id)?;
        let function_name = record.function.as_ref()?;
        let spec = self.snapshot.overlay(&record.namespace)?;
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
            "effect": if record.effect == OverlayEffect::Read { "read" } else { "write" },
            "explain": record.explain,
            "options": options,
        });
        if !describer.bindings.is_empty() {
            out["bindings"] = Value::Array(describer.bindings);
        }
        Some(out)
    }
}
