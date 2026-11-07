//! The inputs of a session: the named scalar parameters of its scripts and their values.
//!
//! Every named scalar parameter `:min` of a script with a current analysis is an input of the session, one per name.
//! Its value is the `@param :min = <literal>` tag of a script (`analyzer::param_tags`), a literal in the Hyper dialect
//! (`sql_literal`). The scripts of the session that use the input hold the same value. A script binds the value of its
//! own tag, a script without one binds the value of the first tag in session order, so a script holds its values on
//! its own and the session reads one value per input.
//!
//! The type of an input is the type of a cast of the parameter, `:min::int`, the first cast in session order, or the
//! type of its literal: `interval '3' day` is an interval, `10` a bigint and `'EU'` text. The unit of an interval is
//! part of its value, a control picks it, so the type of the literal of an interval is `interval` without fields.
//!
//! The planner binds the literal in the dialect of the connection of the statement, `INTERVAL '3' DAY` on Trino. A
//! literal that the dialect can't express and an input without a value are errors of the plan.

use crate::planner::{Prepared, SessionPlanRequest};
use dashql_buffers::formatting::FormattingDialect;
use dashql_core::analyzer::{AnalyzedScript, ParameterKind, SqlType, SqlTypeKind};
use dashql_core::sql_literal::SqlLiteral;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::span::TextSpan;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;

/// Where the type of an input comes from
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputTypeSource {
    /// A cast of the parameter in a script
    Cast,
    /// The literal of the value
    Literal,
    /// Neither, the input is text until it has a value
    None,
}

/// A statement that uses an input
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct InputConsumer {
    /// The script index of the request
    pub script: u32,
    /// The statement
    pub statement: u32,
}

/// An input of the session
#[derive(Clone, Debug, PartialEq)]
pub struct SessionInput {
    /// The name of the parameter
    pub name: Arc<str>,
    /// The type
    pub sql_type: SqlType,
    /// Where the type comes from
    pub type_source: InputTypeSource,
    /// The value of the first `@param` tag with a value in session order, None if no script has one
    pub literal: Option<SqlLiteral>,
    /// The statements that use the input, in session order
    pub consumers: Vec<InputConsumer>,
    /// The problems of the input, e.g. casts to different types
    pub warnings: Vec<String>,
}

/// The inputs of a session, in the order of their first use
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SessionInputs {
    pub inputs: Vec<SessionInput>,
}

impl SessionInputs {
    /// An input by name
    pub fn get(&self, name: &str) -> Option<&SessionInput> {
        self.inputs.iter().find(|i| &*i.name == name)
    }

    /// The value that a script binds to an input: the value of its own tag, the value of the session otherwise
    pub fn value_of<'a>(&'a self, analyzed: &'a AnalyzedScript, name: &str) -> Option<&'a SqlLiteral> {
        if let Some(tag) = analyzed.param_values.iter().find(|t| &*t.name == name) {
            return tag.literal.as_ref();
        }
        self.get(name).and_then(|i| i.literal.as_ref())
    }
}

/// Collect the inputs of the scripts of a session that have a current analysis
pub fn collect_session_inputs(request: &SessionPlanRequest) -> SessionInputs {
    let mut inputs: Vec<SessionInput> = Vec::new();
    let mut index: BTreeMap<Arc<str>, usize> = BTreeMap::new();
    for (si, script) in request.scripts.iter().enumerate() {
        let Some(p) = Prepared::lenient(script.script) else { continue };
        for parameter in &p.analyzed.parameters {
            let (ParameterKind::Scalar, Some(name)) = (parameter.kind, &parameter.name) else { continue };
            // Positional parameters are no inputs
            if name.parse::<u32>().is_ok() {
                continue;
            }
            let i = *index.entry(name.clone()).or_insert_with(|| {
                inputs.push(SessionInput {
                    name: name.clone(),
                    sql_type: SqlType::scalar(SqlTypeKind::Text),
                    type_source: InputTypeSource::None,
                    literal: None,
                    consumers: Vec::new(),
                    warnings: Vec::new(),
                });
                inputs.len() - 1
            });
            let input = &mut inputs[i];
            if let Some(statement) = parameter.ast_statement_id {
                let consumer = InputConsumer { script: si as u32, statement };
                if !input.consumers.contains(&consumer) {
                    input.consumers.push(consumer);
                }
            }
            // The first cast in session order
            match &parameter.cast_type {
                Some(cast) if input.type_source == InputTypeSource::None => {
                    input.sql_type = cast.clone();
                    input.type_source = InputTypeSource::Cast;
                }
                Some(cast) if input.sql_type != *cast => {
                    let warning = format!("input :{name} is cast to {} and to {cast}", input.sql_type);
                    if !input.warnings.contains(&warning) {
                        input.warnings.push(warning);
                    }
                }
                _ => {}
            }
        }
    }
    // The values, the first tag with a value in session order
    for script in request.scripts {
        let Some(p) = Prepared::lenient(script.script) else { continue };
        for tag in &p.analyzed.param_values {
            if let (Some(&i), Some(literal)) = (index.get(&tag.name), &tag.literal) {
                inputs[i].literal.get_or_insert_with(|| literal.clone());
            }
        }
    }
    // An input without a cast has the type of its literal
    for input in inputs.iter_mut().filter(|i| i.type_source == InputTypeSource::None) {
        if let Some(mut literal_type) = input.literal.as_ref().and_then(SqlLiteral::sql_type) {
            if let SqlTypeKind::Interval { fields, .. } = &mut literal_type.kind {
                *fields = None;
            }
            input.sql_type = literal_type;
            input.type_source = InputTypeSource::Literal;
        }
    }
    SessionInputs { inputs }
}

/// The bindings of the inputs of a statement: the text span of every named scalar parameter and its literal in the
/// dialect of the connection, and the problems with their text spans
pub(crate) struct InputBindings {
    pub edits: Vec<(TextSpan, String)>,
    pub errors: Vec<(TextSpan, String)>,
    /// The bound values by name in the Hyper dialect, for the result key
    pub values: BTreeMap<Arc<str>, String>,
}

/// Describe the client function call of a statement for the host, with the values that the script binds in place of its
/// parameters. A parameter without a value stays null, `bind_inputs` makes it an error of the plan.
pub(crate) fn describe_call(inputs: &SessionInputs, analyzed: &AnalyzedScript, statement: u32) -> Option<String> {
    let mut description = analyzed.describe_client_function_call(statement)?;
    let bindings = description.as_object_mut()?.remove("bindings");
    for binding in bindings.as_ref().and_then(Value::as_array).into_iter().flatten() {
        let (Some(pointer), Some(param)) = (binding["pointer"].as_str(), binding["param"].as_str()) else { continue };
        let (Some(literal), Some(option)) = (inputs.value_of(analyzed, param), description["options"].pointer_mut(pointer)) else { continue };
        *option = literal.to_json();
    }
    Some(description.to_string())
}

/// Bind the inputs of a statement, every statement if None
pub(crate) fn bind_inputs(inputs: &SessionInputs, p: &Prepared, statement: Option<u32>, dialect: FormattingDialect) -> InputBindings {
    let mut out = InputBindings { edits: Vec::new(), errors: Vec::new(), values: BTreeMap::new() };
    for parameter in &p.analyzed.parameters {
        let (ParameterKind::Scalar, Some(name)) = (parameter.kind, &parameter.name) else { continue };
        if name.parse::<u32>().is_ok() || (statement.is_some() && parameter.ast_statement_id != statement) {
            continue;
        }
        let span = resolve_text_span(&p.scanned.text, &p.scanned.symbols, parameter.location);
        let Some(literal) = inputs.value_of(p.analyzed, name) else {
            out.errors.push((span, format!("input :{name} has no value")));
            continue;
        };
        match literal.print(dialect) {
            Ok(text) => {
                out.values.insert(name.clone(), literal.to_hyper());
                out.edits.push((span, text));
            }
            Err(e) => out.errors.push((span, format!("input :{name}: {e}"))),
        }
    }
    out
}

