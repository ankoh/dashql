use super::dson::*;
use super::sql_nodes::*;
use dashql_proto::syntax as sx;

#[derive(Debug, Clone)]
pub struct InputStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub value_type: SQLType<'text, 'arena>,
    pub component_type: Option<sx::InputComponentType>,
    pub extra: Option<DsonValue<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct FetchStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub method: sx::FetchMethodType,
    pub from_uri: Option<Expression<'text, 'arena>>,
    pub extra: Option<DsonValue<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct LoadStatement<'text, 'arena> {
    pub name: NamePath<'text, 'arena>,
    pub source: NamePath<'text, 'arena>,
    pub method: sx::LoadMethodType,
    pub extra: Option<DsonValue<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct VizStatement<'text, 'arena> {
    pub target: &'arena TableRef<'text, 'arena>,
    pub components: &'arena [&'arena VizComponent<'text, 'arena>],
}

#[derive(Debug, Clone, Default)]
pub struct VizComponent<'text, 'arena> {
    pub component_type: Option<sx::VizComponentType>,
    pub type_modifiers: u32,
    pub extra: Option<DsonValue<'text, 'arena>>,
}

#[derive(Debug, Clone)]
pub struct SetStatement<'text, 'arena> {
    pub fields: DsonValue<'text, 'arena>,
}
