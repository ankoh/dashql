use super::sql_nodes::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DsonField<'text> {
    #[serde(borrow)]
    pub key: &'text str,
    pub value: DsonValue<'text>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DsonValue<'text> {
    #[serde(borrow)]
    Object(Vec<DsonField<'text>>),
    Array(Vec<DsonValue<'text>>),
    Expression(Expression<'text>),
}
