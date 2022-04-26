use super::dson::*;
use super::enums_serde::*;
use super::sql_nodes::*;
use dashql_proto::syntax as sx;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputStatement<'text> {
    #[serde(borrow, default)]
    pub name: NamePath<'text>,
    pub value_type: SQLType<'text>,
    #[serde(with = "serde_input_component_type::opt")]
    pub component_type: Option<sx::InputComponentType>,
    pub extra: Option<DsonValue<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchStatement<'text> {
    #[serde(borrow)]
    pub name: NamePath<'text>,
    #[serde(with = "serde_fetch_method_type")]
    pub method: sx::FetchMethodType,
    pub from_uri: Option<Expression<'text>>,
    pub extra: Option<DsonValue<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadStatement<'text> {
    #[serde(borrow)]
    pub name: NamePath<'text>,
    pub source: NamePath<'text>,
    #[serde(with = "serde_load_method_type")]
    pub method: sx::LoadMethodType,
    pub extra: Option<DsonValue<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VizStatement<'text> {
    #[serde(borrow)]
    pub target: TableRef<'text>,
    pub components: Vec<VizComponent<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VizComponent<'text> {
    #[serde(with = "serde_viz_component_type::opt")]
    pub component_type: Option<sx::VizComponentType>,
    pub type_modifiers: u32,
    #[serde(borrow)]
    pub extra: Option<DsonValue<'text>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetStatement<'text> {
    #[serde(borrow)]
    pub fields: DsonValue<'text>,
}
