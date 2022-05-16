use super::ast_nodes_sql::*;
use super::dson::*;
use super::enums_serde::*;
use dashql_proto::syntax as sx;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Hash, PartialEq)]
pub struct InputStatement<'a> {
    pub name: NamePath<'a>,
    pub value_type: &'a SQLType<'a>,
    #[serde(with = "serde_input_component_type::opt")]
    pub component_type: Option<sx::InputComponentType>,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq)]
pub struct FetchStatement<'a> {
    pub name: NamePath<'a>,
    #[serde(with = "serde_fetch_method_type")]
    pub method: sx::FetchMethodType,
    pub from_uri: Option<Expression<'a>>,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq)]
pub struct LoadStatement<'a> {
    pub name: NamePath<'a>,
    pub source: NamePath<'a>,
    #[serde(with = "serde_load_method_type")]
    pub method: sx::LoadMethodType,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq)]
pub struct VizStatement<'a> {
    pub target: &'a TableRef<'a>,
    pub components: &'a [&'a VizComponent<'a>],
}

#[derive(Debug, Clone, Serialize, Default, Hash, PartialEq)]
pub struct VizComponent<'a> {
    #[serde(with = "serde_viz_component_type::opt")]
    pub component_type: Option<sx::VizComponentType>,
    pub type_modifiers: u32,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq)]
pub struct SetStatement<'a> {
    pub fields: DsonValue<'a>,
}
