//! The catalog of a Salesforce Data Cloud connection: the relations of the Data Cloud metadata (`/ssot/metadata`) in
//! `lakehouse.public` and the bundled function catalog of Hyper. A Salesforce catalog only refreshes in full, nothing
//! that runs on it changes relations.
//!
//! The update asks for a fresh channel, sends the metadata requests of its data space with the tokens of the channel
//! and reads the responses, a request that failed is a warning as long as one succeeded. The relations stay as they
//! were whichever step fails, the functions are published first.

use dashql_core::catalog::{Catalog, CatalogLayer};
use serde_json::Value;

use super::batch::{publish_prepared, CatalogBatch, CatalogBatchEntry, PreparedDescriptor};
use super::prefetched_hyper_functions::PREFETCHED_HYPER_FUNCTIONS_SQL;
use super::tables::{catalog_tables_of_schema, pack_catalog_descriptor_of_tables, CatalogTable, ColumnMetadata, Groups};
use super::{CatalogEntries, CatalogLoadError, ConnectorCatalogUpdate, ConnectorStep, Publication};
use crate::connections::{ConnectionChannel, ConnectionDetails, SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA};
use crate::http::HttpResponse;
use crate::salesforce::api::get_salesforce_data_space;
use crate::salesforce::{SalesforceMetadataLoad, SharedSalesforceChannel};

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
    salesforce_channel(details.channel.as_ref()).map(|_| ())
}

/// The Salesforce channel with the tokens to read the metadata with
fn salesforce_channel(channel: Option<&ConnectionChannel>) -> Result<&SharedSalesforceChannel, CatalogLoadError> {
    let missing = || CatalogLoadError::failed("Salesforce core access token is missing");
    let channel = channel.and_then(ConnectionChannel::salesforce).ok_or_else(missing)?;
    let core = channel.tokens().core;
    if core.access_token.is_empty() || core.instance_url.as_deref().is_none_or(str::is_empty) {
        return Err(missing());
    }
    Ok(channel)
}

/// How far a Salesforce update got
#[derive(Debug, Clone)]
enum Phase {
    /// Refreshing the channel
    Channel,
    /// Fetching the metadata
    Metadata(Box<SalesforceMetadataLoad>),
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
    /// The requests of the metadata that failed
    warnings: Vec<String>,
}

impl SalesforceCatalogUpdate {
    pub(crate) fn new(details: &ConnectionDetails, entries: CatalogEntries) -> Self {
        Self {
            token_error: check_salesforce_tokens(details).err(),
            entries,
            tables: Vec::new(),
            phase: Phase::Channel,
            warnings: Vec::new(),
        }
    }


    /// Read the metadata, `{"metadata": [...]}`, and parse the functions next
    fn read_metadata(&mut self, metadata: &Value) -> Result<(), CatalogLoadError> {
        self.tables = catalog_tables_from_salesforce_metadata(metadata)?;
        let entry_id = self.entries.function_entry()?;
        let batch = CatalogBatch::new(vec![CatalogBatchEntry {
            entry_id,
            text: PREFETCHED_HYPER_FUNCTIONS_SQL.to_string(),
            require_functions: true,
        }]);
        let prepared = batch.prepare()?.into_iter().next().ok_or_else(|| CatalogLoadError::failed("Catalog batch did not return a descriptor"))?;
        self.phase = Phase::Publish(prepared);
        Ok(())
    }
}

impl ConnectorCatalogUpdate for SalesforceCatalogUpdate {
    fn step(&mut self) -> Result<ConnectorStep, CatalogLoadError> {
        if let Some(error) = self.token_error.take() {
            return Err(error);
        }
        match &self.phase {
            Phase::Channel => Ok(ConnectorStep::FreshChannel),
            Phase::Metadata(load) => Ok(ConnectorStep::Fetch(load.requests().to_vec())),
            Phase::Publish(_) => Ok(ConnectorStep::Publish),
            Phase::Done => Ok(ConnectorStep::Done { partial: None }),
        }
    }

    /// The data space of the tokens of the channel, the requests of its metadata next
    fn answer_channel(&mut self, channel: Option<&ConnectionChannel>) -> Result<(), CatalogLoadError> {
        if !matches!(self.phase, Phase::Channel) {
            return Err(CatalogLoadError::failed("the Salesforce catalog update didn't ask for a channel"));
        }
        let tokens = salesforce_channel(channel)?.tokens();
        let data_space = get_salesforce_data_space(&tokens.data_cloud);
        let (load, _) = SalesforceMetadataLoad::new(&tokens.core, &data_space);
        self.phase = Phase::Metadata(Box::new(load));
        Ok(())
    }

    /// The metadata of the entities that arrived, a request that failed is a warning
    fn answer_fetch(&mut self, responses: Vec<Result<HttpResponse, String>>) -> Result<(), CatalogLoadError> {
        let Phase::Metadata(load) = &mut self.phase else {
            return Err(CatalogLoadError::failed("the Salesforce catalog update didn't ask for metadata"));
        };
        for (index, response) in responses.iter().enumerate() {
            let failure = match response {
                Ok(response) => load.on_response(index, response).and_then(|(_, failure)| failure),
                Err(error) => load.on_failure(index, error).map(|(_, failure)| failure),
            };
            if let Some(failure) = failure {
                self.warnings.push(format!(
                    "Salesforce metadata request failed: {} of data space {}: {}",
                    failure.entity_type, failure.data_space, failure.error
                ));
            }
        }
        let metadata = load.finish().map_err(|error| CatalogLoadError::Failed(error.message))?;
        let metadata = serde_json::to_value(metadata).map_err(|error| CatalogLoadError::Failed(error.to_string()))?;
        self.read_metadata(&metadata)
    }

    fn publish(&mut self, catalog: &mut Catalog) -> Publication {
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

    fn take_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.warnings)
    }
}
