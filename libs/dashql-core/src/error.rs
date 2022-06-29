use dashql_proto as proto;
use std::error::Error;
use std::fmt;
use std::sync::Arc;

use crate::execution::scalar_value::LogicalType;

#[derive(Debug, Clone)]
pub enum SystemError {
    CastFailed(Option<usize>, LogicalType, LogicalType),
    CastNotImplemented(Option<usize>, LogicalType, LogicalType),
    ExpressionTypeNotImplemented(Option<usize>),
    FunctionEvaluationFailed(Arc<dyn Error + Send + Sync>),
    FunctionNotImplemented(String),
    FunctionNotImplementedButKnown(proto::KnownFunction),
    Generic(String),
    ImportNotRegistered(Option<usize>, String),
    ImportURIUnsupported(Option<usize>, String),
    InsufficientArguments,
    InternalError(&'static str),
    InvalidGroupByItem(Option<usize>),
    InvalidStatementRoot(usize, usize),
    InvalidStatementType(&'static str),
    InvalidTableRef(Option<usize>),
    MissingEnvironmentVariable(&'static str),
    NotImplemented(String),
    TaskExecutionFailed(Box<SystemError>),
    TaskPreparationFailed(Box<SystemError>),
    TranslationNotImplemented(Option<usize>, proto::NodeType),
    UnexpectedAttribute(Option<usize>, proto::NodeType, proto::AttributeKey),
    UnexpectedElement(Option<usize>, proto::AttributeKey, proto::NodeType),
}

impl SystemError {
    pub fn const_description(&self) -> &'static str {
        match &self {
            SystemError::CastFailed(_, _, _) => "cast failed",
            SystemError::CastNotImplemented(_, _, _) => "cast not implemented",
            SystemError::ExpressionTypeNotImplemented(_) => "expression type not implemented",
            SystemError::InternalError(err) => err,
            SystemError::FunctionEvaluationFailed(_) => "function evaluation failed",
            SystemError::FunctionNotImplemented(_) => "function not implemented",
            SystemError::FunctionNotImplementedButKnown(_) => "function not implemented",
            SystemError::Generic(_) => "generic",
            SystemError::InsufficientArguments => "insufficient arguments",
            SystemError::ImportNotRegistered(_, _) => "import was not registered",
            SystemError::ImportURIUnsupported(_, _) => "import uri is unsupported",
            SystemError::InvalidGroupByItem(_) => "invalid group by item",
            SystemError::InvalidStatementRoot(_, _) => "invalid statement root",
            SystemError::InvalidStatementType(_) => "invalid statement type",
            SystemError::InvalidTableRef(_) => "invalid table reference",
            SystemError::MissingEnvironmentVariable(_) => "missing environment variable",
            SystemError::TaskPreparationFailed(_) => "task preparation failed",
            SystemError::TaskExecutionFailed(_) => "task execution failed",
            SystemError::TranslationNotImplemented(_, _) => "translation not implemented",
            SystemError::UnexpectedAttribute(_, _, _) => "unexpected attribute",
            SystemError::UnexpectedElement(_, _, _) => "unexpected element",
            SystemError::NotImplemented(_) => "not implemented",
        }
    }
}

impl From<std::string::String> for SystemError {
    fn from(s: std::string::String) -> Self {
        SystemError::Generic(s)
    }
}

impl<'a> fmt::Display for SystemError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            SystemError::CastFailed(_node, from, to) => write!(f, "cast failed: {:?} -> {:?}", from, to),
            SystemError::CastNotImplemented(_node, from, to) => {
                write!(f, "cast not implemented: {:?} -> {:?}", from, to)
            }
            SystemError::ExpressionTypeNotImplemented(_node) => {
                write!(f, "expression type not implemented")
            }
            SystemError::InternalError(e) => write!(f, "internal error: {}", e),
            SystemError::FunctionEvaluationFailed(error) => write!(f, "{}", error.to_string()),
            SystemError::FunctionNotImplemented(func) => {
                write!(f, "function not implemented: {}", func)
            }
            SystemError::FunctionNotImplementedButKnown(func) => {
                write!(f, "function node implemented: {:?}", func)
            }
            SystemError::Generic(error) => write!(f, "error: {:?}", error),
            SystemError::InsufficientArguments => write!(f, "insufficient arguments"),
            SystemError::ImportURIUnsupported(_node, uri) => write!(f, "import has an unsupported URI: {}", uri),
            SystemError::ImportNotRegistered(_node, name) => write!(f, "import not registered: {}", name),
            SystemError::InvalidGroupByItem(_node) => write!(f, "invalid group by item"),
            SystemError::InvalidStatementRoot(stmt_id, node_id) => {
                write!(f, "invalid statement root for statement: {} -> {}", stmt_id, node_id)
            }
            SystemError::InvalidTableRef(_node) => write!(f, "invalid table ref"),
            SystemError::InvalidStatementType(stmt) => write!(f, "invalid statement type: {}", stmt),
            SystemError::MissingEnvironmentVariable(var) => write!(f, "missing environment variable: {}", var),
            SystemError::TaskPreparationFailed(err) => write!(f, "task preparation failed: {}", err),
            SystemError::TaskExecutionFailed(err) => write!(f, "task execution failed: {}", err),
            SystemError::TranslationNotImplemented(_node, node_type) => {
                write!(f, "translation not implemented for type: {:?}", node_type)
            }
            SystemError::UnexpectedAttribute(_node, node_type, key) => {
                write!(f, "unexpected attribute: {:?} -> {:?}", node_type, key)
            }
            SystemError::UnexpectedElement(_node, parent_type, child_type) => {
                write!(f, "unexpected element: {:?} -> {:?}", parent_type, child_type)
            }
            SystemError::NotImplemented(msg) => write!(f, "{}", msg),
        }
    }
}

impl<'a> Error for SystemError {
    fn description(&self) -> &str {
        self.const_description()
    }
}
