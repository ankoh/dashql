use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;
use super::dson::*;
use dashql_proto::syntax as sx;
use serde::Serialize;
use std::fmt::Debug;
use std::hash::Hash;

pub struct ASTRef<V>
where
    V: Debug + Serialize + Clone + PartialEq + Hash,
{
    pub(super) node_id: usize,
    pub inner: V,
}

impl<V> AsRef<V> for ASTRef<V>
where
    V: Debug + Serialize + Clone + PartialEq + Hash,
{
    fn as_ref(&self) -> &V {
        &self.inner
    }
}

impl<V> AsMut<V> for ASTRef<V>
where
    V: Debug + Serialize + Clone + PartialEq + Hash,
{
    fn as_mut(&mut self) -> &mut V {
        &mut self.inner
    }
}

impl<V> Debug for ASTRef<V>
where
    V: Debug + Serialize + Clone + PartialEq + Hash,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.inner.fmt(f)
    }
}

impl<V> Serialize for ASTRef<V>
where
    V: Debug + Serialize + Clone + PartialEq + Hash,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.inner.serialize(serializer)
    }
}
