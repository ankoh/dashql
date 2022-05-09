use super::ast_nodes_sql::*;
use dashql_proto::syntax as sx;

#[derive(Debug, Clone)]
pub enum DsonKey<'arena> {
    Known(sx::AttributeKey),
    Unknown(&'arena str),
}

impl<'arena> Default for DsonKey<'arena> {
    fn default() -> Self {
        Self::Unknown("")
    }
}

#[derive(Debug, Clone, Default)]
pub struct DsonField<'arena> {
    pub key: DsonKey<'arena>,
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

impl<'arena> DsonValue<'arena> {
    pub fn len(&self) -> usize {
        match self {
            DsonValue::Object(fields) => fields.len(),
            DsonValue::Array(elems) => elems.len(),
            DsonValue::Expression(_) => 0,
        }
    }

    pub fn is_object(&self) -> bool {
        match self {
            DsonValue::Object(_) => true,
            _ => false,
        }
    }
    pub fn is_array(&self) -> bool {
        match self {
            DsonValue::Array(_) => true,
            _ => false,
        }
    }
    pub fn is_expression(&self) -> bool {
        match self {
            DsonValue::Expression(_) => true,
            _ => false,
        }
    }

    pub fn as_object(&self) -> &'arena [DsonField<'arena>] {
        match self {
            DsonValue::Object(fields) => fields,
            DsonValue::Array(_) => &[],
            DsonValue::Expression(_) => &[],
        }
    }
    pub fn as_array(&self) -> &'arena [DsonValue<'arena>] {
        match self {
            DsonValue::Object(_) => &[],
            DsonValue::Array(values) => values,
            DsonValue::Expression(_) => &[],
        }
    }
}

pub trait DsonAccess<Idx>
where
    Idx: Sized,
{
    type Output: Sized;
    fn get(&self, index: Idx) -> Option<Self::Output>;
}

impl<'arena> DsonAccess<usize> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;
    fn get(&self, index: usize) -> Option<Self::Output> {
        match self {
            DsonValue::Expression(_) | DsonValue::Object(_) => None,
            DsonValue::Array(a) => Some(&a[index]),
        }
    }
}

impl<'arena> DsonAccess<sx::AttributeKey> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;
    fn get(&self, index: sx::AttributeKey) -> Option<Self::Output> {
        match self {
            DsonValue::Object(o) => o
                .binary_search_by(|f| match f.key {
                    DsonKey::Known(probe) => probe.cmp(&index),
                    DsonKey::Unknown(_) => std::cmp::Ordering::Greater,
                })
                .ok()
                .map(|idx| &o[idx].value),
            DsonValue::Expression(_) | DsonValue::Array(_) => None,
        }
    }
}

impl<'arena> DsonAccess<&str> for DsonValue<'arena> {
    type Output = &'arena DsonValue<'arena>;

    fn get(&self, index: &str) -> Option<Self::Output> {
        match self {
            DsonValue::Object(o) => o
                .iter()
                .find(|f| match f.key {
                    DsonKey::Known(probe) => probe.variant_name().unwrap_or_default() == index,
                    DsonKey::Unknown(probe) => probe == index,
                })
                .map(|f| &f.value),
            DsonValue::Expression(_) | DsonValue::Array(_) => None,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::grammar::{self, Statement};
    use std::error::Error;

    #[test]
    fn test_set_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        let text = r#"
            set 'key' = 42;
        "#;
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast)?;
        assert_eq!(prog.statements.len(), 1);

        let stmt = match &prog.statements[0] {
            Statement::Set(set) => set,
            _ => panic!("unexpected statement: {:?}", &prog.statements[0]),
        };
        assert!(stmt.fields.get("key").is_some());
        match stmt.fields.get("key") {
            Some(DsonValue::Expression(Expression::StringRef(s))) => {
                assert_eq!(s.clone(), "42");
            }
            _ => panic!("unexpected dson value: {:?}", stmt.fields),
        };
        Ok(())
    }
}
