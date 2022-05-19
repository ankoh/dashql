use serde::Serialize;
use std::cell::Cell;
use std::fmt::Debug;
use std::hash::Hash;

pub struct ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    node_id: Option<usize>,
    inner: Cell<V>,
}

impl<V> ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    pub fn with_value(value: V) -> Self {
        Self {
            node_id: None,
            inner: Cell::new(value),
        }
    }
    pub fn with_node(value: V, node_id: usize) -> Self {
        Self {
            node_id: Some(node_id),
            inner: Cell::new(value),
        }
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
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
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
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.inner.get().fmt(f)
    }
}

impl<V> Serialize for ASTCell<V>
where
    V: Debug + Serialize + Clone + Copy + PartialEq + Eq + Hash,
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
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.inner.get().hash(state);
    }
}

impl<V> PartialEq for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    fn eq(&self, other: &Self) -> bool {
        self.inner.get() == other.inner.get()
    }
}

impl<V> Clone for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    fn clone(&self) -> Self {
        Self {
            node_id: self.node_id.clone(),
            inner: self.inner.clone(),
        }
    }
}

impl<V> Eq for ASTCell<V> where V: Debug + Clone + Copy + PartialEq + Eq + Hash {}

impl<V> Default for ASTCell<V>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash + Default,
{
    fn default() -> Self {
        Self {
            node_id: None,
            inner: Cell::new(Default::default()),
        }
    }
}

impl<V> ASTCell<Option<V>>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash,
{
    pub fn unwrap(self) -> ASTCell<V> {
        ASTCell {
            node_id: self.node_id,
            inner: Cell::new(self.inner.get().unwrap()),
        }
    }
    pub fn unwrap_or(self, value: V) -> ASTCell<V> {
        ASTCell {
            node_id: self.node_id,
            inner: Cell::new(self.inner.get().unwrap_or(value)),
        }
    }
}

impl<V> ASTCell<Option<V>>
where
    V: Debug + Clone + Copy + PartialEq + Eq + Hash + Default,
{
    pub fn unwrap_or_default(self) -> ASTCell<V> {
        ASTCell {
            node_id: self.node_id,
            inner: Cell::new(self.inner.get().unwrap_or_default()),
        }
    }
}
