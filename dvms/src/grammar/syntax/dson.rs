use super::ast_nodes_sql::*;

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
