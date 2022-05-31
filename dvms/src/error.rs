use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum SystemErrorCode {
    ASTTranslationMissing,
    CastFailed,
    CastNotImplemented,
    ExpressionLogicMissing,
    FunctionEvaluationFailed,
    FunctionLogicMissing,
    InsufficientArguments,
    Invalid,
    InvalidArgumentType,
    InvalidColumnConstraint,
    InvalidGroupByItem,
    InvalidStatement,
    InvalidTableRef,
    UnexpectedAttribute,
    UnexpectedElement,
}

#[derive(Debug)]
pub enum SystemErrorDetail {
    String(String),
    Str(&'static str),
}

#[derive(Debug)]
pub struct SystemError {
    pub node_id: Option<usize>,
    pub code: SystemErrorCode,
    pub detail: Option<SystemErrorDetail>,
}

impl SystemError {
    pub fn new(node_id: Option<usize>, code: SystemErrorCode) -> Self {
        Self {
            node_id,
            code,
            detail: None,
        }
    }
    pub fn with_detail(node_id: Option<usize>, code: SystemErrorCode, detail: &'static str) -> Self {
        Self {
            node_id,
            code,
            detail: Some(SystemErrorDetail::Str(detail)),
        }
    }
    pub fn with_detail_string(node_id: Option<usize>, code: SystemErrorCode, detail: String) -> Self {
        Self {
            node_id,
            code,
            detail: Some(SystemErrorDetail::String(detail)),
        }
    }
    pub fn code_description(&self) -> &'static str {
        match self.code {
            SystemErrorCode::ASTTranslationMissing => "ast translation not implemented",
            SystemErrorCode::CastNotImplemented => "cast not implemented",
            SystemErrorCode::CastFailed => "cast failed",
            SystemErrorCode::ExpressionLogicMissing => "expression logic not implemented",
            SystemErrorCode::FunctionEvaluationFailed => "function evaluation failed",
            SystemErrorCode::FunctionLogicMissing => "function logic not implemented",
            SystemErrorCode::InsufficientArguments => "insufficient arguments",
            SystemErrorCode::Invalid => "invalid",
            SystemErrorCode::InvalidArgumentType => "invalid argument type",
            SystemErrorCode::InvalidColumnConstraint => "invalid column constraint",
            SystemErrorCode::InvalidGroupByItem => "invalid group by item",
            SystemErrorCode::InvalidStatement => "invalid statement",
            SystemErrorCode::InvalidTableRef => "invalid table ref",
            SystemErrorCode::UnexpectedAttribute => "unexpected attribute",
            SystemErrorCode::UnexpectedElement => "unexpected element",
        }
    }
}

impl<'a> fmt::Display for SystemError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if let Some(node_id) = self.node_id {
            write!(f, "[{}] {}", node_id, self.code_description())?;
        } else {
            write!(f, "{}", self.code_description())?;
        }
        match &self.detail {
            Some(SystemErrorDetail::Str(s)) => write!(f, ": {}", s)?,
            Some(SystemErrorDetail::String(s)) => write!(f, ": {}", s)?,
            None => {}
        }
        Ok(())
    }
}

impl<'a> Error for SystemError {
    fn description(&self) -> &str {
        self.code_description()
    }
}
