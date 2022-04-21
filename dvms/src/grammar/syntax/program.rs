use serde::{Deserialize, Serialize};

use super::sql_nodes::SelectStatement;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Statement<'text> {
    #[serde(borrow)]
    Select(SelectStatement<'text>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Program<'text> {
    #[serde(borrow)]
    pub statements: Vec<Statement<'text>>,
}
