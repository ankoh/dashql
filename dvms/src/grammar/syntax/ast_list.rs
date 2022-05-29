use super::ast_cell::*;
use serde::ser::SerializeSeq;
use serde::Serialize;
use std::cell::Cell;
use std::fmt::Debug;
use std::hash::Hash;

#[derive(Clone)]
pub struct ASTListNode<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    pub next: Cell<Option<&'a ASTListNode<'a, V>>>,
    pub prev: Cell<Option<&'a ASTListNode<'a, V>>>,
    pub value: ASTCell<V>,
}

impl<'a, V> Hash for ASTListNode<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.next.get().hash(state);
        self.prev.get().hash(state);
        self.value.get().hash(state);
    }
}

pub struct ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    pub first: Cell<&'a ASTListNode<'a, V>>,
    pub last: Cell<&'a ASTListNode<'a, V>>,
    pub length: usize,
}

impl<'a, V> Debug for ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut list = f.debug_list();
        let mut iter = self.first.get();
        list.entry(&iter.value.get());
        while let Some(next) = iter.next.get() {
            list.entry(&next.value.get());
            iter = next;
        }
        list.finish()
    }
}

impl<'a, V> Serialize for ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    fn serialize<S>(&self, ser: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let mut seq = ser.serialize_seq(Some(self.length))?;
        let mut iter = self.first.get();
        seq.serialize_element(&iter.value.get())?;
        while let Some(next) = iter.next.get() {
            seq.serialize_element(&next.value.get())?;
            iter = next;
        }
        seq.end()
    }
}

impl<'a, V> PartialEq for ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    fn eq(&self, other: &Self) -> bool {
        if self.length != other.length {
            return false;
        }
        let mut left = self.first.get();
        let mut right = other.first.get();
        if !left.value.eq(&right.value) {
            return false;
        }
        while let Some(l) = left.next.get() {
            let r = right.next.get().unwrap();
            if !l.value.eq(&r.value) {
                return false;
            }
            left = l;
            right = r;
        }
        return true;
    }
}
impl<'a, V> Eq for ASTList<'a, V> where V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq {}

impl<'a, V> Hash for ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let mut iter = self.first.get();
        iter.hash(state);
        while let Some(next) = iter.next.get() {
            next.hash(state);
            iter = next;
        }
    }
}

impl<'a, V> ASTList<'a, V>
where
    V: Debug + Clone + Copy + Serialize + Hash + PartialEq + Eq,
{
    pub fn new(left: ASTCell<V>, right: ASTCell<V>, arena: &'a bumpalo::Bump) -> Self {
        let left = arena.alloc(ASTListNode {
            prev: Cell::new(None),
            next: Cell::new(None),
            value: left,
        });
        let right = arena.alloc(ASTListNode {
            prev: Cell::new(None),
            next: Cell::new(None),
            value: right,
        });
        left.next.set(Some(right));
        right.prev.set(Some(left));
        ASTList {
            first: Cell::new(left),
            last: Cell::new(right),
            length: 2,
        }
    }

    pub fn append(&self, value: ASTCell<V>, arena: &'a bumpalo::Bump) -> Self {
        let self_first = self.first.get();
        let self_last = self.last.get();
        let node = arena.alloc(ASTListNode {
            prev: Cell::new(Some(self_last)),
            next: Cell::new(None),
            value,
        });
        self_last.next.set(Some(node));
        ASTList {
            first: Cell::new(self_first),
            last: Cell::new(node),
            length: self.length + 1,
        }
    }

    pub fn prepend(&self, value: ASTCell<V>, arena: &'a bumpalo::Bump) -> Self {
        let self_first = self.first.get();
        let self_last = self.last.get();
        let node = arena.alloc(ASTListNode {
            prev: Cell::new(None),
            next: Cell::new(Some(self_first)),
            value,
        });
        self_first.prev.set(Some(node));
        ASTList {
            first: Cell::new(node),
            last: Cell::new(self_last),
            length: self.length + 1,
        }
    }

    pub fn merge(&self, other: &ASTList<'a, V>) -> Self {
        let self_first = self.first.get();
        let self_last = self.last.get();
        let other_first = other.first.get();
        let other_last = other.last.get();
        self_last.next.set(Some(other_first));
        other_first.prev.set(Some(self_last));
        ASTList {
            first: Cell::new(self_first),
            last: Cell::new(other_last),
            length: self.length + other.length,
        }
    }
}
