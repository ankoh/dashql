use dashql_proto as proto;
use std::error::Error;
use std::fmt;

use crate::execution::scalar_value::LogicalType;

#[derive(Debug)]
pub enum SystemError {
    InternalError(&'static str),
    CastFailed(Option<usize>, LogicalType, LogicalType),
    CastNotImplemented(Option<usize>, LogicalType, LogicalType),
    ExpressionTypeNotImplemented(Option<usize>),
    FunctionEvaluationFailed(Box<dyn Error + Send + Sync>),
    FunctionNotImplemented(String),
    FunctionNotImplementedButKnown(proto::KnownFunction),
    Generic(String),
    HTTPRequestFailed(reqwest::Error),
    InsufficientArguments,
    InvalidImport(String),
    InvalidGroupByItem(Option<usize>),
    InvalidStatementRoot(Option<usize>),
    InvalidStatementType(&'static str),
    InvalidTableRef(Option<usize>),
    TaskPreparationFailed(Box<SystemError>),
    TaskExecutionFailed(Box<SystemError>),
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
            SystemError::HTTPRequestFailed(_) => "http request failed",
            SystemError::InsufficientArguments => "insufficient arguments",
            SystemError::InvalidImport(_) => "invalid import",
            SystemError::InvalidGroupByItem(_) => "invalid group by item",
            SystemError::InvalidStatementRoot(_) => "invalid statement root",
            SystemError::InvalidStatementType(_) => "invalid statement type",
            SystemError::InvalidTableRef(_) => "invalid table reference",
            SystemError::TaskPreparationFailed(_) => "task preparation failed",
            SystemError::TaskExecutionFailed(_) => "task execution failed",
            SystemError::TranslationNotImplemented(_, _) => "translation not implemented",
            SystemError::UnexpectedAttribute(_, _, _) => "unexpected attribute",
            SystemError::UnexpectedElement(_, _, _) => "unexpected element",
        }
    }
}

impl From<std::string::String> for SystemError {
    fn from(s: std::string::String) -> Self {
        SystemError::Generic(s)
    }
}

impl From<reqwest::Error> for SystemError {
    fn from(e: reqwest::Error) -> Self {
        SystemError::HTTPRequestFailed(e)
    }
}

impl<'a> fmt::Display for SystemError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match &self {
            SystemError::CastFailed(node, from, to) => write!(f, "[{:?}] cast failed: {:?} -> {:?}", node, from, to),
            SystemError::CastNotImplemented(node, from, to) => {
                write!(f, "[{:?}] cast not implemented: {:?} -> {:?}", node, from, to)
            }
            SystemError::ExpressionTypeNotImplemented(node) => {
                write!(f, "[{:?}] expression type not implemented", node)
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
            SystemError::HTTPRequestFailed(error) => write!(f, "http request failed: {:?}", error),
            SystemError::InsufficientArguments => write!(f, "insufficient arguments"),
            SystemError::InvalidImport(repr) => write!(f, "invalid import: {}", repr),
            SystemError::InvalidGroupByItem(node) => write!(f, "[{:?}] invalid group by item", node),
            SystemError::InvalidStatementRoot(stmt) => write!(f, "[{:?}] invalid statement root", stmt),
            SystemError::InvalidTableRef(node) => write!(f, "[{:?}] invalid table ref", node),
            SystemError::InvalidStatementType(stmt) => write!(f, "invalid statement type: {}", stmt),
            SystemError::TaskPreparationFailed(err) => write!(f, "task preparation failed: {}", err),
            SystemError::TaskExecutionFailed(err) => write!(f, "task execution failed: {}", err),
            SystemError::TranslationNotImplemented(node, node_type) => {
                write!(f, "[{:?}] translation not implemented for type: {:?}", node, node_type)
            }
            SystemError::UnexpectedAttribute(node, node_type, key) => {
                write!(f, "[{:?}] unexpected attribute: {:?} -> {:?}", node, node_type, key)
            }
            SystemError::UnexpectedElement(node, parent_type, child_type) => {
                write!(
                    f,
                    "[{:?}] unexpected element: {:?} -> {:?}",
                    node, parent_type, child_type
                )
            }
        }
    }
}

impl<'a> Error for SystemError {
    fn description(&self) -> &str {
        self.const_description()
    }
}
