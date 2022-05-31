use dashql_proto::syntax as sx;
use std::error::Error;
use std::fmt;

use crate::execution::scalar_value::LogicalType;

#[derive(Debug)]
pub enum SystemError {
    CastFailed(Option<usize>, LogicalType, LogicalType),
    CastNotImplemented(Option<usize>, LogicalType, LogicalType),
    ExpressionTypeNotImplemented(Option<usize>),
    FunctionEvaluationFailed(Option<usize>, Box<dyn Error + Send + Sync>),
    FunctionNotImplemented(Option<usize>, String),
    FunctionNotImplementedButKnown(Option<usize>, sx::KnownFunction),
    InsufficientArguments(Option<usize>),
    InvalidColumnConstraint(Option<usize>),
    InvalidGroupByItem(Option<usize>),
    InvalidStatementRoot(Option<usize>),
    InvalidTableRef(Option<usize>),
    TranslationNotImplemented(Option<usize>, sx::NodeType),
    UnexpectedAttribute(Option<usize>, sx::NodeType, sx::AttributeKey),
    UnexpectedElement(Option<usize>, sx::AttributeKey, sx::NodeType),
}

impl SystemError {
    pub fn const_description(&self) -> &'static str {
        match &self {
            SystemError::CastFailed(_, _, _) => "cast failed",
            SystemError::CastNotImplemented(_, _, _) => "cast not implemented",
            SystemError::ExpressionTypeNotImplemented(_) => "expression type not implemented",
            SystemError::FunctionEvaluationFailed(_, _) => "function evaluation failed",
            SystemError::FunctionNotImplemented(_, _) => "function not implemented",
            SystemError::FunctionNotImplementedButKnown(_, _) => "function not implemented",
            SystemError::InsufficientArguments(_) => "insufficient arguments",
            SystemError::InvalidColumnConstraint(_) => "invalid column constraint",
            SystemError::InvalidGroupByItem(_) => "invalid group by item",
            SystemError::InvalidStatementRoot(_) => "invalid statement root",
            SystemError::InvalidTableRef(_) => "invalid table reference",
            SystemError::TranslationNotImplemented(_, _) => "translation not implemented",
            SystemError::UnexpectedAttribute(_, _, _) => "unexpected attribute",
            SystemError::UnexpectedElement(_, _, _) => "unexpected element",
        }
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
            SystemError::FunctionEvaluationFailed(node, error) => write!(f, "[{:?}] {}", node, error.to_string()),
            SystemError::FunctionNotImplemented(node, func) => {
                write!(f, "[{:?}] function not implemented: {}", node, func)
            }
            SystemError::FunctionNotImplementedButKnown(node, func) => {
                write!(f, "[{:?}] function node implemented: {:?}", node, func)
            }
            SystemError::InsufficientArguments(node) => write!(f, "[{:?}] insufficient arguments", node),
            SystemError::InvalidColumnConstraint(node) => write!(f, "[{:?}] invalid column constraint", node),
            SystemError::InvalidGroupByItem(node) => write!(f, "[{:?}] invalid group by item", node),
            SystemError::InvalidStatementRoot(stmt) => write!(f, "[{:?}] invalid statement root", stmt),
            SystemError::InvalidTableRef(node) => write!(f, "[{:?}] invalid table ref", node),
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
