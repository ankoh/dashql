use super::ast_cell::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use super::enums_serde::*;
use dashql_proto as proto;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct DeclareStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub value_type: ASTCell<&'a SQLType<'a>>,
    #[serde(with = "serde_input_component_type::cell")]
    pub component_type: ASTCell<proto::InputComponentType>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct ImportStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    #[serde(with = "serde_import_method_type::cell")]
    pub method: ASTCell<proto::ImportMethodType>,
    pub from_uri: ASTCell<Option<Expression<'a>>>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct LoadStatement<'a> {
    pub name: ASTCell<NamePath<'a>>,
    pub source: ASTCell<NamePath<'a>>,
    #[serde(with = "serde_load_method_type::cell")]
    pub method: ASTCell<proto::LoadMethodType>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct VizStatement<'a> {
    pub target: ASTCell<TableRef<'a>>,
    #[serde(with = "serde_viz_component_type::cell_opt")]
    pub component_type: ASTCell<Option<proto::VizComponentType>>,
    pub type_modifiers: ASTCell<u32>,
    pub extra: ASTCell<Option<DsonValue<'a>>>,
}

#[derive(Debug, Clone, Serialize, Hash, PartialEq, Eq)]
pub struct SetStatement<'a> {
    pub fields: ASTCell<DsonValue<'a>>,
}
