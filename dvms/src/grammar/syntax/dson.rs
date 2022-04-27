use super::sql_nodes::*;

#[derive(Debug, Clone, Default)]
pub struct DsonField<'text, 'bump> {
    pub key: &'text str,
    pub value: DsonValue<'text, 'bump>,
}

#[derive(Debug, Clone)]
pub enum DsonValue<'text, 'bump> {
    Object(&'bump [DsonField<'text, 'bump>]),
    Array(&'bump [DsonValue<'text, 'bump>]),
    Expression(Expression<'text, 'bump>),
}

impl<'text, 'bump> Default for DsonValue<'text, 'bump> {
    fn default() -> Self {
        DsonValue::Expression(Expression::Null)
    }
}
