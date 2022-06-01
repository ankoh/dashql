use super::ast_cell::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::enums_serde::*;
use dashql_proto::syntax as sx;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct InputStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub value_type: ASTCell<&'a SQLType<'a>>,
    #[serde(with = "serde_input_component_type::cell_opt")]
    pub component_type: ASTCell<Option<sx::InputComponentType>>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct FetchStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    #[serde(with = "serde_fetch_method_type::cell")]
    pub method: ASTCell<sx::FetchMethodType>,
    pub from_uri: ASTCell<Option<Expression<'a>>>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct LoadStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub source: ASTCell<NamePath<'a>>,
    #[serde(with = "serde_load_method_type::cell")]
    pub method: ASTCell<sx::LoadMethodType>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct VizStatement<'a> {
    pub target: ASTCell<TableRef<'a>>,
    #[serde(with = "serde_viz_component_type::cell_opt")]
    pub component_type: ASTCell<Option<sx::VizComponentType>>,
    pub type_modifiers: ASTCell<u32>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SetStatement<'a> {
    pub fields: ASTCell<DsonValue<'a>>,
}
