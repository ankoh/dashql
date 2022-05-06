use super::ast_nodes_sql::*;
use dashql_proto::syntax as sx;

#[derive(Debug, Clone, Default)]
pub struct DsonField<'arena> {
    pub key: &'arena str,
    pub value: DsonValue<'arena>,
}

#[derive(Debug, Clone)]
pub enum DsonValue<'arena> {
    Object(&'arena [DsonField<'arena>]),
    Array(&'arena [DsonValue<'arena>]),
    Expression(Expression<'arena>),
}

impl<'arena> Default for DsonValue<'arena> {
    fn default() -> Self {
        DsonValue::Expression(Expression::Null)
    }
}

impl<'arena> std::ops::Index<sx::AttributeKey> for DsonValue<'arena> {
    type Output = Option<DsonValue<'arena>>;

    fn index(&self, index: sx::AttributeKey) -> &Self::Output {
        match self {
            DsonValue::Object(o) => (),
            DsonValue::Array(a) => (),
            DsonValue::Expression(e) => (),
        }
        todo!()
    }
}

impl<'arena> std::ops::Index<usize> for DsonValue<'arena> {
    type Output = Option<DsonValue<'arena>>;

    fn index(&self, index: usize) -> &Self::Output {
        match self {
            DsonValue::Object(o) => (),
            DsonValue::Array(a) => (),
            DsonValue::Expression(e) => (),
        }
        todo!()
    }
}

impl<'arena> std::ops::Index<&str> for DsonValue<'arena> {
    type Output = Option<DsonValue<'arena>>;

    fn index(&self, index: &str) -> &Self::Output {
        match self {
            DsonValue::Object(o) => (),
            DsonValue::Array(a) => (),
            DsonValue::Expression(e) => (),
        }
        todo!()
    }
}
