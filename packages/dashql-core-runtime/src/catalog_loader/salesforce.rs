//! The catalog of a Salesforce Data Cloud connection: the relations of the Data Cloud metadata (`/ssot/metadata`) in
//! `lakehouse.public` and the bundled function catalog of Hyper. A Salesforce catalog only refreshes in full, nothing
//! that runs on it changes relations.
//!
//! The Salesforce client fetches the metadata, the update reads it. The relations stay as they were whichever step
//! fails, the functions are published first.

use dashql_core::catalog::{Catalog, CatalogLayer};
use serde_json::Value;

use super::batch::{publish_prepared, CatalogBatch, CatalogBatchEntry, PreparedDescriptor};
use super::prefetched_hyper_functions::PREFETCHED_HYPER_FUNCTIONS_SQL;
use super::tables::{catalog_tables_of_schema, pack_catalog_descriptor_of_tables, CatalogTable, ColumnMetadata, Groups};
use super::{CatalogEntries, CatalogLoadError, ConnectorStep, Publication};
use crate::connections::{ConnectionChannel, ConnectionDetails, SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA};

/// The relations of the Data Cloud metadata, `{"metadata": [{"name": ..., "fields": [{"name": ..., "type": ...}]}]}`, in
/// `lakehouse.public`. A later entity of a name replaces an earlier one. Fails if the metadata names no column.
pub fn catalog_tables_from_salesforce_metadata(metadata: &Value) -> Result<Vec<CatalogTable>, CatalogLoadError> {
    let mut tables: Groups<String, Vec<ColumnMetadata>> = Groups::new();
    let entities = metadata.get("metadata").and_then(Value::as_array);
    for entity in entities.into_iter().flatten() {
        let Some(name) = entity.get("name").and_then(Value::as_str) else {
            continue;
        };
        let fields = entity.get("fields").and_then(Value::as_array);
        let columns = fields
            .into_iter()
            .flatten()
            .filter_map(|field| {
                let name = field.get("name").and_then(Value::as_str)?;
                Some((name, field.get("type").and_then(Value::as_str)))
            })
            .enumerate()
            .map(|(position, (name, data_type))| ColumnMetadata {
                name: name.to_string(),
                ordinal_position: position as i64,
                data_type: data_type.map(str::to_string),
            })
            .collect();
        *tables.entry(&name.to_string()) = columns;
    }
    let tables = tables.into_entries();
    let column_count: usize = tables.iter().map(|(_, columns)| columns.len()).sum();
    if tables.is_empty() || column_count == 0 {
        return Err(CatalogLoadError::failed("Salesforce metadata returned no usable catalog relations"));
    }
    Ok(catalog_tables_of_schema(SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA, tables))
}

/// Check that a Salesforce connection has the tokens to read the metadata with, its channel holds them
pub fn check_salesforce_tokens(details: &ConnectionDetails) -> Result<(), CatalogLoadError> {
    let Some(channel) = details.channel.as_ref().and_then(ConnectionChannel::salesforce) else {
        return Err(CatalogLoadError::failed("Salesforce core access token is missing"));
    };
    let core = channel.tokens().core;
    if core.access_token.is_empty() || core.instance_url.as_deref().is_none_or(str::is_empty) {
        return Err(CatalogLoadError::failed("Salesforce core access token is missing"));
    }
    Ok(())
}

/// How far a Salesforce update got
#[derive(Debug, Clone, PartialEq)]
enum Phase {
    /// Fetching the metadata
    Metadata,
    /// Parsing the functions
    Batch(CatalogBatch),
    /// Publishing
    Publish(PreparedDescriptor),
    /// Published
    Done,
}

/// An update of the catalog of a Salesforce Data Cloud connection
#[derive(Debug)]
pub struct SalesforceCatalogUpdate {
    /// Why the connection can't read its metadata
    token_error: Option<CatalogLoadError>,
    /// The entries to publish into
    entries: CatalogEntries,
    /// The tables of the metadata
    tables: Vec<CatalogTable>,
    /// How far the update got
    phase: Phase,
}

impl SalesforceCatalogUpdate {
    pub(crate) fn new(details: &ConnectionDetails, entries: CatalogEntries) -> Self {
        Self { token_error: check_salesforce_tokens(details).err(), entries, tables: Vec::new(), phase: Phase::Metadata }
    }

    pub(crate) fn step(&mut self) -> Result<ConnectorStep, CatalogLoadError> {
        if let Some(error) = self.token_error.take() {
            return Err(error);
        }
        match &self.phase {
            Phase::Metadata => Ok(ConnectorStep::FetchSalesforceMetadata),
            Phase::Batch(batch) => Ok(ConnectorStep::ProcessBatch(batch.clone())),
            Phase::Publish(_) => Ok(ConnectorStep::Publish),
            Phase::Done => Ok(ConnectorStep::Done { partial: None }),
        }
    }

    pub(crate) fn answer_metadata(&mut self, metadata: &Value) -> Result<(), CatalogLoadError> {
        if self.phase != Phase::Metadata {
            return Err(CatalogLoadError::failed("the Salesforce catalog update didn't ask for metadata"));
        }
        self.tables = catalog_tables_from_salesforce_metadata(metadata)?;
        let entry_id = self.entries.function_entry()?;
        self.phase = Phase::Batch(CatalogBatch::new(vec![CatalogBatchEntry {
            entry_id,
            text: PREFETCHED_HYPER_FUNCTIONS_SQL.to_string(),
            require_functions: true,
        }]));
        Ok(())
    }

    pub(crate) fn answer_batch(&mut self, result: &[u8]) -> Result<(), CatalogLoadError> {
        let Phase::Batch(batch) = &self.phase else {
            return Err(CatalogLoadError::failed("the Salesforce catalog update didn't ask for a batch"));
        };
        let prepared = batch.prepare(result)?;
        let prepared = prepared.into_iter().next().ok_or_else(|| CatalogLoadError::failed("Catalog batch did not return a descriptor"))?;
        self.phase = Phase::Publish(prepared);
        Ok(())
    }

    pub(crate) fn publish(&mut self, catalog: &mut Catalog) -> Publication {
        let Phase::Publish(prepared) = std::mem::replace(&mut self.phase, Phase::Done) else {
            return Publication::of(Err(CatalogLoadError::failed("the Salesforce catalog update didn't ask to publish")));
        };
        if let Err(error) = publish_prepared(catalog, std::slice::from_ref(&prepared)) {
            return Publication::of(Err(error));
        }
        let result = catalog
            .replace_descriptor(self.entries.relations, CatalogLayer::CONNECTION, &pack_catalog_descriptor_of_tables(&self.tables))
            .map(|()| None)
            .map_err(CatalogLoadError::from);
        Publication { function_script_text: Some(PREFETCHED_HYPER_FUNCTIONS_SQL.to_string()), result }
    }
}
