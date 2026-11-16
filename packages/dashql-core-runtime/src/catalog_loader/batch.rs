//! Catalog batches: SQL of the catalog of a connection that the core parses into descriptors, in the batch worker,
//! before they are published into the connection layer of the catalog.
//!
//! A batch never parses on the catalog it publishes into, the worker runs `process_batch` on a catalog of its own. A
//! batch publishes only while it is current: a newer batch of the same catalog or a reset of the connection
//! (`ConnectionEffect::InvalidateCatalogBatch`) supersedes it.
//!
//! The worker, its lifetime and the abort signals stay with the host.

use std::collections::HashMap;

use dashql_buffers::batch::{BatchRequestT, BatchResult, BatchScriptInputT, DiagnosticSeverity};
use dashql_buffers::catalog::CatalogDescriptor;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer};
use dashql_core_script::batch::process_batch;

use super::tables::pack_bytes;
use super::CatalogLoadError;

/// The output mask of a batch script that asks for the catalog descriptor
const BATCH_OUTPUT_CATALOG_DESCRIPTOR: u32 = 8;

/// The generations of the catalog batches of the catalogs, by the id of the catalog
#[derive(Debug, Clone, Default)]
pub struct CatalogGenerations {
    generations: HashMap<u64, u64>,
}

/// The generation of a catalog that a batch began with
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogTicket {
    /// The id of the catalog
    pub catalog_id: u64,
    /// The generation
    pub generation: u64,
}

impl CatalogGenerations {
    /// Supersede the pending batches of a catalog, e.g. when its connection is reset
    pub fn invalidate(&mut self, catalog_id: u64) -> u64 {
        let generation = self.generations.entry(catalog_id).or_insert(0);
        *generation += 1;
        *generation
    }

    /// Begin a batch: supersede the pending ones. A batch begins before it fetches metadata, not after, so a slow fetch
    /// can't supersede a newer refresh.
    pub fn begin(&mut self, catalog_id: u64) -> CatalogTicket {
        CatalogTicket { catalog_id, generation: self.invalidate(catalog_id) }
    }

    /// Is a batch still current?
    pub fn is_current(&self, ticket: CatalogTicket) -> bool {
        self.generations.get(&ticket.catalog_id) == Some(&ticket.generation)
    }

    /// Fail with a cancellation if a batch was superseded
    pub fn check(&self, ticket: CatalogTicket) -> Result<(), CatalogLoadError> {
        if self.is_current(ticket) {
            Ok(())
        } else {
            Err(CatalogLoadError::cancelled("Catalog refresh was cancelled or superseded"))
        }
    }

    /// Forget a catalog that is gone
    pub fn forget(&mut self, catalog_id: u64) {
        self.generations.remove(&catalog_id);
    }
}

/// SQL of the catalog of a connection, published as a descriptor under an entry id. A script that keeps the text, such
/// as the function script of a connection, gets the text once the descriptor is published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogBatchEntry {
    /// The entry id to publish the descriptor under
    pub entry_id: CatalogEntryId,
    /// The SQL
    pub text: String,
    /// Must the descriptor declare functions? The function catalog of Hyper never is empty.
    pub require_functions: bool,
}

/// What a descriptor of a batch declares
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CatalogBatchCounts {
    pub tables: usize,
    pub functions: usize,
}

/// A descriptor of a batch, checked and ready to publish
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedDescriptor {
    /// The entry id
    pub entry_id: CatalogEntryId,
    /// The descriptor
    pub descriptor: Vec<u8>,
    /// What it declares
    pub counts: CatalogBatchCounts,
}

/// A catalog batch
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogBatch {
    pub entries: Vec<CatalogBatchEntry>,
}

impl CatalogBatch {
    /// A batch of entries
    pub fn new(entries: Vec<CatalogBatchEntry>) -> Self {
        Self { entries }
    }

    /// The `BatchRequest` for the batch worker
    pub fn request(&self) -> Vec<u8> {
        let mut request = BatchRequestT::default();
        request.scripts = Some(
            self.entries
                .iter()
                .map(|entry| {
                    let mut input = BatchScriptInputT::default();
                    input.id = Some(entry.entry_id.to_string());
                    input.text = Some(entry.text.clone());
                    input.outputs = BATCH_OUTPUT_CATALOG_DESCRIPTOR;
                    input
                })
                .collect(),
        );
        pack_bytes!(request)
    }

    /// Process the batch here instead of in the worker, the `BatchResult`
    pub fn process(&self) -> Result<Vec<u8>, CatalogLoadError> {
        process_batch(&self.request()).map_err(|error| CatalogLoadError::failed(error.message))
    }

    /// Check the `BatchResult` of the batch: a descriptor for every entry, no errors in the SQL
    pub fn prepare(&self, result: &[u8]) -> Result<Vec<PreparedDescriptor>, CatalogLoadError> {
        let result = flatbuffers::root::<BatchResult>(result)
            .map_err(|_| CatalogLoadError::failed("Catalog batch returned an invalid result"))?
            .unpack();
        let scripts = result.scripts.unwrap_or_default();
        if scripts.len() != self.entries.len() {
            return Err(CatalogLoadError::failed("Catalog batch returned an unexpected script count"));
        }
        self.entries
            .iter()
            .map(|entry| {
                let id = entry.entry_id.to_string();
                let matches: Vec<_> = scripts.iter().filter(|script| script.id.as_deref() == Some(id.as_str())).collect();
                let output = match matches.as_slice() {
                    [output] if output.failure.is_none() => *output,
                    [output, ..] => {
                        let failure = output.failure.clone();
                        return Err(CatalogLoadError::failed(
                            failure.unwrap_or_else(|| "Catalog batch did not return a descriptor".to_string()),
                        ));
                    }
                    [] => return Err(CatalogLoadError::failed("Catalog batch did not return a descriptor")),
                };
                let error = output.diagnostics.iter().flatten().find(|diagnostic| diagnostic.severity == DiagnosticSeverity::ERROR);
                if let Some(error) = error {
                    return Err(CatalogLoadError::failed(format!(
                        "Catalog contains invalid SQL: {}",
                        error.message.as_deref().unwrap_or("")
                    )));
                }
                let descriptor = output.catalog_descriptor.clone().filter(|descriptor| !descriptor.is_empty());
                let descriptor = descriptor.ok_or_else(|| CatalogLoadError::failed("Catalog batch did not return a descriptor"))?;
                let read = flatbuffers::root::<CatalogDescriptor>(&descriptor)
                    .map_err(|_| CatalogLoadError::failed("Catalog batch returned an invalid descriptor"))?;
                let counts = CatalogBatchCounts {
                    tables: read.tables().map_or(0, |tables| tables.len()),
                    functions: read.function_declarations().map_or(0, |functions| functions.len()),
                };
                if entry.require_functions && counts.functions == 0 {
                    return Err(CatalogLoadError::failed("Hyper function catalog is empty"));
                }
                Ok(PreparedDescriptor { entry_id: entry.entry_id, descriptor, counts })
            })
            .collect()
    }
}

/// Publish prepared descriptors into the connection layer of a catalog, in order. A failure stops the publication,
/// the descriptors before it stay published.
pub fn publish_prepared(catalog: &mut Catalog, prepared: &[PreparedDescriptor]) -> Result<(), CatalogLoadError> {
    for descriptor in prepared {
        catalog.replace_descriptor(descriptor.entry_id, CatalogLayer::CONNECTION, &descriptor.descriptor)?;
    }
    Ok(())
}

/// Process and publish a batch right away, e.g. the bundled functions of a new connection or the catalog files of a
/// restored one. It supersedes the pending batches of the catalog. The scripts of the entries get their texts from the
/// caller once this succeeded.
pub fn publish_catalog_batch_sync(
    catalog: &mut Catalog,
    generations: &mut CatalogGenerations,
    batch: &CatalogBatch,
) -> Result<Vec<CatalogBatchCounts>, CatalogLoadError> {
    generations.begin(catalog.id());
    if batch.entries.is_empty() {
        return Ok(Vec::new());
    }
    let prepared = batch.prepare(&batch.process()?)?;
    publish_prepared(catalog, &prepared)?;
    Ok(prepared.iter().map(|prepared| prepared.counts).collect())
}
