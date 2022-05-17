use serde::Serialize;
use std::cell::Cell;
use std::fmt::Debug;
use std::hash::Hash;

pub struct ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    pub(super) node_id: Option<usize>,
    pub inner: Cell<V>,
}

impl<V> ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    pub fn with_node_id(mut self, node_id: usize) -> Self {
        self.node_id = Some(node_id);
        self
    }
    pub fn get_node_id(&self) -> Option<usize> {
        self.node_id
    }
    pub fn get(&self) -> V {
        self.inner.get()
    }
}

impl<V> From<V> for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    fn from(v: V) -> Self {
        Self {
            node_id: None,
            inner: Cell::new(v),
        }
    }
}

impl<V> Debug for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.inner.get().fmt(f)
    }
}

impl<V> Serialize for ASTCell<V>
where
    V: Debug + Serialize + Clone + Copy + PartialEq + Hash,
{
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        self.inner.get().serialize(serializer)
    }
}

impl<V> Hash for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.inner.get().hash(state);
    }
}

impl<V> PartialEq for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    fn eq(&self, other: &Self) -> bool {
        self.inner.get() == other.inner.get()
    }
}

impl<V> Clone for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Hash,
{
    fn clone(&self) -> Self {
        Self {
            node_id: self.node_id.clone(),
            inner: self.inner.clone(),
        }
    }
}
