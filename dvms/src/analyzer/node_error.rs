use std::error::Error;
use std::fmt;

#[derive(Debug)]
pub enum NodeErrorCode {
    Invalid,
    InsufficientArguments,
    InvalidArgumentType,
}

#[derive(Debug)]
pub struct NodeError {
    pub node_id: Option<usize>,
    pub code: NodeErrorCode,
    pub message: Option<String>,
}

impl NodeError {
    pub fn new(node_id: Option<usize>, code: NodeErrorCode) -> Self {
        Self {
            node_id,
            code,
            message: None,
        }
    }

    pub fn with_message(node_id: Option<usize>, code: NodeErrorCode, message: String) -> Self {
        Self {
            node_id,
            code,
            message: Some(message),
        }
    }
}

impl fmt::Display for NodeError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if let Some(node_id) = self.node_id {
            write!(f, "{}: {:?}", node_id, self.code)
        } else {
            write!(f, "{:?}", self.code)
        }
    }
}

impl Error for NodeError {
    fn description(&self) -> &str {
        match self.code {
            NodeErrorCode::Invalid => "invalid",
            NodeErrorCode::InsufficientArguments => "insufficient arguments",
            NodeErrorCode::InvalidArgumentType => "invalid argument type",
        }
    }
}
