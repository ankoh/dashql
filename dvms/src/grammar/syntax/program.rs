use serde::{Deserialize, Serialize};

use super::dashql_nodes::*;
use super::sql_nodes::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Statement<'text> {
    #[serde(borrow)]
    Select(SelectStatement<'text>),
    Input(InputStatement<'text>),
    Fetch(FetchStatement<'text>),
    Viz(VizStatement<'text>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Program<'text> {
    #[serde(borrow)]
    pub statements: Vec<Statement<'text>>,
}
