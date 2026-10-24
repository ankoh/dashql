//! The name search index of a catalog entry.
//!
//! Every suffix of every name, sorted case-insensitively as (name, suffix offset) pairs, so that a
//! prefix search over the suffixes finds substring matches. Equal suffixes keep the order of the
//! names.

use super::entry::CatalogObjectRef;
use crate::utils::{ci_cmp, ci_starts_with};
use dashql_buffers::analyzer::NameTag;
use dashql_parser::span::TextSpan;
use std::sync::{Arc, OnceLock};

/// A name of the index (the fields of `RegisteredName` the completion reads)
#[derive(Clone, Debug)]
pub struct IndexedName {
    /// The name text
    pub text: Arc<str>,
    /// How often the name occurs in the entry
    pub occurrences: u32,
    /// The location of the first occurrence in the script text
    pub location: TextSpan,
    /// The analyzer tags
    pub tags: NameTag,
    /// The objects the name resolves to
    pub objects: Vec<CatalogObjectRef>,
}

/// A substring search index over the names of a catalog entry.
///
/// The names are collected when the entry is created, the suffixes are sorted on the first search, so
/// that analyses which are never searched don't pay for the index.
#[derive(Debug, Default)]
pub struct NameSearchIndex {
    /// The indexed names, the suffixes refer to them by index
    pub names: Vec<IndexedName>,
    /// (name index, byte offset of the suffix), sorted case-insensitively by the suffix, built on first use
    suffixes: OnceLock<Vec<(u32, u32)>>,
}

impl NameSearchIndex {
    pub fn new(names: Vec<IndexedName>) -> Self {
        Self {
            names,
            suffixes: OnceLock::new(),
        }
    }

    /// The sorted suffixes
    fn suffixes(&self) -> &[(u32, u32)] {
        self.suffixes.get_or_init(|| {
            let mut suffixes = Vec::new();
            for (i, name) in self.names.iter().enumerate() {
                suffixes.extend((0..name.text.len() as u32).map(|offset| (i as u32, offset)));
            }
            // Stable, so equal keys keep the order of the names
            suffixes.sort_by(|a, b| ci_cmp(self.suffix(*a), self.suffix(*b)));
            suffixes
        })
    }

    /// Were the suffixes sorted already?
    pub fn is_built(&self) -> bool {
        self.suffixes.get().is_some()
    }

    /// The number of indexed suffixes
    pub fn len(&self) -> usize {
        self.suffixes().len()
    }

    pub fn is_empty(&self) -> bool {
        self.suffixes().is_empty()
    }

    /// The bytes of the suffix index
    pub fn byte_size(&self) -> usize {
        self.suffixes().len() * std::mem::size_of::<(u32, u32)>()
    }

    fn suffix(&self, entry: (u32, u32)) -> &[u8] {
        &self.names[entry.0 as usize].text.as_bytes()[entry.1 as usize..]
    }

    /// The names that have a suffix starting with `prefix`, once per matching suffix, in index order
    pub fn search<'a>(&'a self, prefix: &'a [u8]) -> impl Iterator<Item = &'a IndexedName> + 'a {
        let suffixes = self.suffixes();
        let begin = suffixes.partition_point(|&e| ci_cmp(self.suffix(e), prefix) == std::cmp::Ordering::Less);
        suffixes[begin..]
            .iter()
            .take_while(move |&&e| ci_starts_with(self.suffix(e), prefix))
            .map(move |&(name, _)| &self.names[name as usize])
    }
}
