use super::ast_nodes_sql::*;
use super::dson::*;
use dashql_proto::syntax as sx;

#[derive(Debug, Clone)]
pub struct InputStatement<'a> {
    pub name: NamePath<'a>,
    pub value_type: &'a SQLType<'a>,
    pub component_type: Option<sx::InputComponentType>,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone)]
pub struct FetchStatement<'a> {
    pub name: NamePath<'a>,
    pub method: sx::FetchMethodType,
    pub from_uri: Option<Expression<'a>>,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone)]
pub struct LoadStatement<'a> {
    pub name: NamePath<'a>,
    pub source: NamePath<'a>,
    pub method: sx::LoadMethodType,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone)]
pub struct VizStatement<'a> {
    pub target: &'a TableRef<'a>,
    pub components: &'a [&'a VizComponent<'a>],
}

#[derive(Debug, Clone, Default)]
pub struct VizComponent<'a> {
    pub component_type: Option<sx::VizComponentType>,
    pub type_modifiers: u32,
    pub extra: Option<DsonValue<'a>>,
}

#[derive(Debug, Clone)]
pub struct SetStatement<'a> {
    pub fields: DsonValue<'a>,
}
