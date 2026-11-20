//! The names of a script: identifiers and keywords that may be used as names.

use crate::span::TextSpan;

/// The id of a registered name, unique within a script
pub type NameId = u32;

/// A registered name
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegisteredName {
    /// The name id
    pub name_id: NameId,
    /// The text (lower-cased unless the name was quoted)
    pub text: String,
    /// The location of the first occurrence (empty for names without one)
    pub location: TextSpan,
    /// The number of occurrences
    pub occurrences: u32,
}

/// The names of a script, ids are assigned in order of first registration.
///
/// An open-addressing table over the names (name id + 1 per slot, 0 = empty), so the texts are
/// stored once.
#[derive(Clone, Debug, Default)]
pub struct NameRegistry {
    /// The names indexed by name id
    names: Vec<RegisteredName>,
    /// The hash slots holding name id + 1, 0 for an empty slot, the length is a power of two
    table: Vec<u32>,
}

/// A fast hash for short names (FxHash over 8-byte words)
fn hash(text: &[u8]) -> u64 {
    const K: u64 = 0x517c_c1b7_2722_0a95;
    let mut h: u64 = text.len() as u64;
    let mut chunks = text.chunks_exact(8);
    for chunk in &mut chunks {
        // `chunks_exact(8)` yields 8 bytes
        let word = <[u8; 8]>::try_from(chunk).map(u64::from_le_bytes).unwrap_or(0);
        h = (h.rotate_left(5) ^ word).wrapping_mul(K);
    }
    for &b in chunks.remainder() {
        h = (h.rotate_left(5) ^ b as u64).wrapping_mul(K);
    }
    h
}

impl NameRegistry {
    /// The number of names
    pub fn len(&self) -> usize {
        self.names.len()
    }

    /// Are there no names?
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Get a name, an id of another registry reads as an empty name without occurrences
    pub fn get(&self, id: NameId) -> &RegisteredName {
        static UNKNOWN: RegisteredName =
            RegisteredName { name_id: NameId::MAX, text: String::new(), location: TextSpan::new(0, 0), occurrences: 0 };
        self.names.get(id as usize).unwrap_or(&UNKNOWN)
    }

    /// All names in id order
    pub fn iter(&self) -> impl Iterator<Item = &RegisteredName> {
        self.names.iter()
    }

    /// The slot of a name text and its entry: either the slot holding it or the empty slot where it belongs, `None`
    /// for a table without an empty slot (the table is kept at most half full)
    fn slot(&self, text: &str) -> Option<(usize, u32)> {
        let mask = self.table.len().wrapping_sub(1);
        let mut slot = hash(text.as_bytes()) as usize & mask;
        for _ in 0..self.table.len() {
            let entry = *self.table.get(slot)?;
            match entry {
                0 => return Some((slot, entry)),
                id if self.names.get((id as usize).wrapping_sub(1)).is_some_and(|name| name.text == text) => {
                    return Some((slot, entry))
                }
                _ => slot = (slot + 1) & mask,
            }
        }
        None
    }

    /// Find a name by its text
    pub fn find(&self, text: &str) -> Option<NameId> {
        match self.slot(text)? {
            (_, 0) => None,
            (_, id) => Some(id - 1),
        }
    }

    fn grow(&mut self) {
        let capacity = (self.table.len() * 2).max(64);
        let mut table = vec![0; capacity];
        let mask = capacity - 1;
        for (i, name) in self.names.iter().enumerate() {
            let mut slot = hash(name.text.as_bytes()) as usize & mask;
            // The new table is at most half full, a probe finds an empty slot
            while table.get(slot).is_some_and(|&entry| entry != 0) {
                slot = (slot + 1) & mask;
            }
            if let Some(entry) = table.get_mut(slot) {
                *entry = i as u32 + 1;
            }
        }
        self.table = table;
    }

    /// Register a name. A known name counts another occurrence and keeps its first location.
    pub fn register(&mut self, text: &str, location: TextSpan) -> NameId {
        if (self.names.len() + 1) * 2 > self.table.len() {
            self.grow();
        }
        // The table is at most half full after growing, a probe finds the name or an empty slot
        let (slot, entry) = self.slot(text).unwrap_or((usize::MAX, 0));
        if let Some(name) = entry.checked_sub(1).and_then(|id| self.names.get_mut(id as usize)) {
            name.occurrences += 1;
            return entry - 1;
        }
        let id = self.names.len() as NameId;
        self.names.push(RegisteredName { name_id: id, text: text.to_string(), location, occurrences: 1 });
        if let Some(entry) = self.table.get_mut(slot) {
            *entry = id + 1;
        }
        id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_names_once() {
        let mut names = NameRegistry::default();
        assert_eq!(names.register("foo", TextSpan::new(0, 3)), 0);
        assert_eq!(names.register("bar", TextSpan::new(4, 3)), 1);
        assert_eq!(names.register("foo", TextSpan::new(8, 3)), 0);
        assert_eq!(names.len(), 2);
        assert_eq!(names.get(0).occurrences, 2);
        assert_eq!(names.get(0).location, TextSpan::new(0, 3));
        assert_eq!(names.find("bar"), Some(1));
        assert_eq!(names.find("baz"), None);
    }

    #[test]
    fn grows() {
        let mut names = NameRegistry::default();
        for i in 0..1000 {
            assert_eq!(names.register(&format!("name{i}"), TextSpan::default()), i);
        }
        for i in 0..1000 {
            assert_eq!(names.find(&format!("name{i}")), Some(i));
            assert_eq!(names.register(&format!("name{i}"), TextSpan::default()), i);
        }
        assert_eq!(names.len(), 1000);
    }
}
