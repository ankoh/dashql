use super::sql_nodes::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DsonField<'text> {
    #[serde(borrow)]
    pub key: &'text str,
    pub value: DsonValue<'text>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DsonObject<'text> {
    #[serde(borrow)]
    pub fields: Vec<DsonField<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DsonValue<'text> {
    #[serde(borrow)]
    Object(DsonObject<'text>),
    Array(Vec<DsonValue<'text>>),
    Expression(Expression<'text>),
}
