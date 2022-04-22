use super::enums_serde::*;
use super::sql_nodes::*;
use dashql_proto::syntax as sx;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputStatement<'text> {
    #[serde(borrow, default)]
    pub name: NamePath<'text>,
    pub value_type: SQLType<'text>,
    #[serde(with = "serde_input_component_type")]
    pub component_type: sx::InputComponentType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchStatement<'text> {
    #[serde(borrow)]
    pub name: NamePath<'text>,
    #[serde(with = "serde_fetch_method_type")]
    pub fetch_method: sx::FetchMethodType,
    pub fetch_from_uri: Option<Expression<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VizStatement<'text> {
    #[serde(borrow)]
    pub target: TableRef<'text>,
}
