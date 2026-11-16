//! The latest analyzed result of every result owner, e.g. a workbook script.
//!
//! The computation of a result replaces the computation of the previous result of its owner once it is analyzed, the
//! previous result stays until then. A result that is analyzed after a later result of the same owner, e.g. of an
//! overlapping rerun, is stale.
//!
//! Ported from `packages/dashql/src/runtime/connections/result_computations.ts`.

use std::collections::HashMap;

/// The latest analyzed query of every owner
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResultComputations {
    latest: HashMap<String, u64>,
}

impl ResultComputations {
    /// No results
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the analyzed result of an owner, returns the computation that is no longer needed: the previous
    /// result of the owner, or the result itself if a later one is registered already
    pub fn retain(&mut self, owner: &str, query_id: u64) -> Option<u64> {
        match self.latest.get(owner).copied() {
            Some(latest) if latest > query_id => Some(query_id),
            previous => {
                self.latest.insert(owner.to_string(), query_id);
                previous
            }
        }
    }
}
