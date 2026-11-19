//! The catalog loader: the SQL that describes the catalog of a connection, the descriptors and table updates that the
//! answers become, and when to update which catalog.
//!
//! Everything here is sans-IO. An update of a catalog is a state machine (`CatalogUpdate`) that the host drives: it
//! asks for the queries to run, the Data Cloud metadata of a Salesforce connection, a catalog batch to parse in the
//! batch worker and the moment to publish into the catalog, and it takes their answers. The scheduler
//! (`CatalogLoader`) decides when a catalog is described, refreshed or asked about the relations of executed
//! statements and hands out the updates to start. The connection keeps the state of the updates
//! (`connections::CatalogUpdates`), the host reports every step as a `ConnectionAction`.

pub mod batch;
mod columns;
pub mod hyper;
pub mod information_schema;
pub mod pg_attribute;
pub mod pg_proc;
pub mod prefetched_hyper_functions;
mod prefetched_hyper_functions_sql;
pub mod salesforce;
pub mod scheduler;
pub mod service;
pub mod sql;
pub mod tables;
pub mod trino;

use std::fmt;

use arrow_array::RecordBatch;
use arrow_schema::ArrowError;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogVersion};
use serde_json::Value;

use crate::connections::{
    CatalogUpdateTask, CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionAction, ConnectionState,
    ConnectorType, DetailedError, RelationName, Timestamp,
};
use crate::query::QueryType;

pub use batch::{CatalogBatch, CatalogBatchEntry, CatalogGenerations, CatalogTicket};
pub use scheduler::{CatalogLoader, CatalogLoaderCommand, CatalogLoaderConnection, CatalogSchedule};
pub use service::{CatalogLoaderHost, CatalogLoaderService, FollowedConnection, QueryBatches};

/// The read timeout of the metadata queries of Hyper
pub const CATALOG_QUERY_READ_TIMEOUT_MS: u32 = 60_000;

/// Why an update of a catalog didn't succeed
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogLoadError {
    /// The update was cancelled or superseded, e.g. by a forced refresh or a reset of the connection
    Cancelled(String),
    /// The update failed
    Failed(String),
}

impl CatalogLoadError {
    pub fn cancelled(message: impl Into<String>) -> Self {
        Self::Cancelled(message.into())
    }

    pub fn failed(message: impl Into<String>) -> Self {
        Self::Failed(message.into())
    }

    /// The message
    pub fn message(&self) -> &str {
        match self {
            Self::Cancelled(message) | Self::Failed(message) => message,
        }
    }
}

impl fmt::Display for CatalogLoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for CatalogLoadError {}

impl From<dashql_core::error::Error> for CatalogLoadError {
    fn from(error: dashql_core::error::Error) -> Self {
        Self::Failed(error.what().to_string())
    }
}

impl From<ArrowError> for CatalogLoadError {
    fn from(error: ArrowError) -> Self {
        Self::Failed(error.to_string())
    }
}

/// A metadata query of a catalog update. The host runs it on the connection as a query of the app and registers it
/// with the update (`ConnectionAction::CatalogUpdateRegisterQuery`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogQuery {
    /// The SQL
    pub sql: String,
    /// The kind of the query
    pub query_type: QueryType,
    /// The title of the query
    pub title: String,
    /// Does the query have a read timeout? Its length is the setting `catalog_query_timeout_ms` of the host, without
    /// one the default of the connection applies.
    pub read_timeout: bool,
}

/// The issuer of the metadata queries
pub const CATALOG_QUERY_ISSUER: &str = "Catalog Update";

/// The answer of a query: the result batches, or the message of the error
pub type QueryAnswer = Result<Vec<RecordBatch>, String>;

/// What a catalog update asks the host for next
#[derive(Debug, Clone, PartialEq)]
pub enum CatalogStep {
    /// Run the queries on the connection, at the same time, and answer with `answer_queries` in their order
    Query(Vec<CatalogQuery>),
    /// Fetch the Data Cloud metadata of the Salesforce connection (`/ssot/metadata`) and answer with
    /// `answer_salesforce_metadata`
    FetchSalesforceMetadata,
    /// Process the batch, e.g. in the batch worker (`CatalogBatch::request`), and answer with `answer_batch`
    ProcessBatch(CatalogBatch),
    /// Publish into the catalog of the connection with `publish`
    Publish,
    /// The update finished
    Finished(CatalogUpdateOutcome),
}

/// How a catalog update ended
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogUpdateOutcome {
    /// Succeeded, partially succeeded, failed or cancelled
    pub status: CatalogUpdateTaskStatus,
    /// The error of an update that didn't succeed, the databases that failed of a partial one
    pub error: Option<String>,
    /// Did the catalog change?
    pub catalog_changed: bool,
    /// The new text of the function script of the connection, once its descriptor is published. The host sets it,
    /// also if a later step failed.
    pub function_script_text: Option<String>,
    /// What the host logs as warnings, e.g. skipped functions or duplicate columns
    pub warnings: Vec<String>,
}

impl CatalogUpdateOutcome {
    fn ended(status: CatalogUpdateTaskStatus, error: Option<String>) -> Self {
        Self { status, error, catalog_changed: false, function_script_text: None, warnings: Vec::new() }
    }

    /// The action that finishes the update on its connection
    pub fn connection_action(&self, task_id: u32) -> ConnectionAction {
        let error = || DetailedError::new(self.error.clone().unwrap_or_default());
        match self.status {
            CatalogUpdateTaskStatus::Succeeded | CatalogUpdateTaskStatus::Started => {
                ConnectionAction::CatalogUpdateSucceeded { task_id }
            }
            CatalogUpdateTaskStatus::PartiallySucceeded => {
                ConnectionAction::CatalogUpdatePartiallySucceeded { task_id, error: error() }
            }
            CatalogUpdateTaskStatus::Failed => ConnectionAction::CatalogUpdateFailed { task_id, error: error() },
            CatalogUpdateTaskStatus::Cancelled => ConnectionAction::CatalogUpdateCancelled { task_id, error: error() },
        }
    }

    /// Is the new catalog announced, so that scripts that read it are analyzed again?
    pub fn announces(&self) -> bool {
        matches!(self.status, CatalogUpdateTaskStatus::Succeeded | CatalogUpdateTaskStatus::PartiallySucceeded)
    }
}

/// What the update of a connector asks for next
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ConnectorStep {
    Query(Vec<CatalogQuery>),
    FetchSalesforceMetadata,
    ProcessBatch(CatalogBatch),
    Publish,
    /// Finished without publishing, with the error of the databases that failed
    Done { partial: Option<String> },
}

/// What a publication did
#[derive(Debug)]
pub(crate) struct Publication {
    /// The text of the function script, once its descriptor is published
    pub function_script_text: Option<String>,
    /// The error of the databases that failed if the publication succeeded, the error that stopped it otherwise
    pub result: Result<Option<String>, CatalogLoadError>,
}

impl Publication {
    /// A publication without a function script
    pub(crate) fn of(result: Result<Option<String>, CatalogLoadError>) -> Self {
        Self { function_script_text: None, result }
    }
}

/// The update of a connector
#[derive(Debug)]
enum ConnectorUpdate {
    Hyper(hyper::HyperCatalogUpdate),
    Trino(trino::TrinoCatalogUpdate),
    Salesforce(salesforce::SalesforceCatalogUpdate),
}

/// What an update waits for
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Awaiting {
    Nothing,
    Queries(usize),
    Metadata,
    Batch,
    Publish,
}

/// An update of the catalog of a connection
#[derive(Debug)]
pub struct CatalogUpdate {
    /// The connection
    connection_id: String,
    /// The task id
    task_id: u32,
    /// The generation of the catalog that the update began with
    ticket: CatalogTicket,
    /// The version of the catalog when the update began
    version_before: CatalogVersion,
    /// The update of the connector
    connector: ConnectorUpdate,
    /// What the update waits for
    awaiting: Awaiting,
    /// The text of the function script once it is published
    function_script_text: Option<String>,
    /// How the update ended
    outcome: Option<CatalogUpdateOutcome>,
}

impl CatalogUpdate {
    /// Start an update of the catalog of a connection: all of it, or the relations of executed statements. Returns the
    /// update and the action that registers it with the connection. It supersedes the pending batches of the catalog.
    pub fn start(
        connection: &ConnectionState,
        task_id: u32,
        relations: Option<Vec<RelationName>>,
        generations: &mut CatalogGenerations,
        now: Timestamp,
    ) -> Result<(Self, ConnectionAction), CatalogLoadError> {
        let (catalog_id, version_before) = {
            let catalog = connection.catalog().try_borrow().map_err(|_| CatalogLoadError::failed("the catalog is in use"))?;
            (catalog.id(), catalog.version())
        };
        let variant = match relations {
            Some(_) => CatalogUpdateVariant::RelationRefresh,
            None => CatalogUpdateVariant::FullCatalogRefresh,
        };
        let task = CatalogUpdateTask { touched_relations: relations.clone().unwrap_or_default(), ..CatalogUpdateTask::new(task_id, variant, now) };
        let entries = CatalogEntries {
            relations: connection.relation_entry_id(),
            functions: connection.function_script().map(|script| script.catalog_entry_id()),
        };
        let details = connection.details();
        let setup_params = details.setup_params.clone().unwrap_or_default();
        let connector = match connection.connector_type() {
            ConnectorType::Hyper => {
                ConnectorUpdate::Hyper(hyper::HyperCatalogUpdate::of_hyper(&setup_params, entries, relations, now))
            }
            ConnectorType::Dbcom => {
                ConnectorUpdate::Hyper(hyper::HyperCatalogUpdate::of_dbcom(&setup_params, entries, relations, now))
            }
            ConnectorType::Trino => ConnectorUpdate::Trino(trino::TrinoCatalogUpdate::new(&setup_params, entries, relations)),
            ConnectorType::SalesforceDataCloud => {
                ConnectorUpdate::Salesforce(salesforce::SalesforceCatalogUpdate::new(details, entries))
            }
        };
        let update = Self {
            connection_id: connection.connection_id().to_string(),
            task_id,
            ticket: generations.begin(catalog_id),
            version_before,
            connector,
            awaiting: Awaiting::Nothing,
            function_script_text: None,
            outcome: None,
        };
        Ok((update, ConnectionAction::UpdateCatalog(task)))
    }

    pub fn connection_id(&self) -> &str {
        &self.connection_id
    }
    pub fn task_id(&self) -> u32 {
        self.task_id
    }
    pub fn ticket(&self) -> CatalogTicket {
        self.ticket
    }
    pub fn outcome(&self) -> Option<&CatalogUpdateOutcome> {
        self.outcome.as_ref()
    }

    /// The warnings of the connector so far
    fn warnings(&mut self) -> Vec<String> {
        match &mut self.connector {
            ConnectorUpdate::Hyper(update) => std::mem::take(&mut update.warnings),
            ConnectorUpdate::Trino(_) => Vec::new(),
            ConnectorUpdate::Salesforce(_) => Vec::new(),
        }
    }

    /// End the update
    fn finish(&mut self, mut outcome: CatalogUpdateOutcome) {
        if self.outcome.is_some() {
            return;
        }
        outcome.warnings = self.warnings();
        if outcome.function_script_text.is_none() {
            outcome.function_script_text = self.function_script_text.take();
        }
        self.awaiting = Awaiting::Nothing;
        self.outcome = Some(outcome);
    }

    /// End the update with an error
    fn fail(&mut self, error: CatalogLoadError) {
        let status = match error {
            CatalogLoadError::Cancelled(_) => CatalogUpdateTaskStatus::Cancelled,
            CatalogLoadError::Failed(_) => CatalogUpdateTaskStatus::Failed,
        };
        let catalog_changed = self.function_script_text.is_some();
        let mut outcome = CatalogUpdateOutcome::ended(status, Some(error.message().to_string()));
        outcome.catalog_changed = catalog_changed;
        self.finish(outcome);
    }

    /// Cancel the update, e.g. when its cancellation token fired or its connection got another catalog
    pub fn cancel(&mut self, reason: &str) {
        self.fail(CatalogLoadError::cancelled(reason));
    }

    /// End the update with an error that the host ran into, e.g. a catalog that it couldn't borrow
    pub fn abort(&mut self, error: CatalogLoadError) {
        self.fail(error);
    }

    /// What the update asks for next. An update whose batch was superseded is cancelled.
    pub fn next(&mut self, generations: &CatalogGenerations) -> CatalogStep {
        if let Some(outcome) = &self.outcome {
            return CatalogStep::Finished(outcome.clone());
        }
        if let Err(error) = generations.check(self.ticket) {
            self.fail(error);
            return self.next(generations);
        }
        let step = match &mut self.connector {
            ConnectorUpdate::Hyper(update) => update.step(),
            ConnectorUpdate::Trino(update) => update.step(),
            ConnectorUpdate::Salesforce(update) => update.step(),
        };
        match step {
            Err(error) => {
                self.fail(error);
                self.next(generations)
            }
            Ok(ConnectorStep::Done { partial }) => {
                let status = match partial {
                    Some(_) => CatalogUpdateTaskStatus::PartiallySucceeded,
                    None => CatalogUpdateTaskStatus::Succeeded,
                };
                self.finish(CatalogUpdateOutcome::ended(status, partial));
                self.next(generations)
            }
            Ok(ConnectorStep::Query(queries)) => {
                self.awaiting = Awaiting::Queries(queries.len());
                CatalogStep::Query(queries)
            }
            Ok(ConnectorStep::FetchSalesforceMetadata) => {
                self.awaiting = Awaiting::Metadata;
                CatalogStep::FetchSalesforceMetadata
            }
            Ok(ConnectorStep::ProcessBatch(batch)) => {
                self.awaiting = Awaiting::Batch;
                CatalogStep::ProcessBatch(batch)
            }
            Ok(ConnectorStep::Publish) => {
                self.awaiting = Awaiting::Publish;
                CatalogStep::Publish
            }
        }
    }

    /// Take the answer the update waits for, an answer it didn't ask for fails it
    fn awaited(&mut self, awaiting: Awaiting) -> bool {
        if self.outcome.is_some() {
            return false;
        }
        if self.awaiting != awaiting {
            self.fail(CatalogLoadError::failed("the catalog update got an answer it didn't ask for"));
            return false;
        }
        self.awaiting = Awaiting::Nothing;
        true
    }

    /// Answer the queries of a `CatalogStep::Query`, in their order
    pub fn answer_queries(&mut self, answers: Vec<QueryAnswer>) {
        if !self.awaited(Awaiting::Queries(answers.len())) {
            return;
        }
        let result = match &mut self.connector {
            ConnectorUpdate::Hyper(update) => update.answer_queries(answers),
            ConnectorUpdate::Trino(update) => update.answer_queries(answers),
            ConnectorUpdate::Salesforce(_) => Err(CatalogLoadError::failed("a Salesforce catalog update runs no queries")),
        };
        if let Err(error) = result {
            self.fail(error);
        }
    }

    /// Answer the `CatalogStep::FetchSalesforceMetadata` with the JSON body of the metadata, `{"metadata": [...]}`
    pub fn answer_salesforce_metadata(&mut self, metadata: Result<Value, String>) {
        if !self.awaited(Awaiting::Metadata) {
            return;
        }
        let result = match &mut self.connector {
            ConnectorUpdate::Salesforce(update) => match metadata {
                Ok(metadata) => update.answer_metadata(&metadata),
                Err(error) => Err(CatalogLoadError::Failed(error)),
            },
            _ => Err(CatalogLoadError::failed("only a Salesforce catalog update reads metadata")),
        };
        if let Err(error) = result {
            self.fail(error);
        }
    }

    /// Answer the `CatalogStep::ProcessBatch` with the `BatchResult` of the batch worker
    pub fn answer_batch(&mut self, result: Result<Vec<u8>, String>) {
        if !self.awaited(Awaiting::Batch) {
            return;
        }
        let result = match result {
            Err(error) => Err(CatalogLoadError::Failed(error)),
            Ok(result) => match &mut self.connector {
                ConnectorUpdate::Hyper(update) => update.answer_batch(&result),
                ConnectorUpdate::Salesforce(update) => update.answer_batch(&result),
                ConnectorUpdate::Trino(_) => Err(CatalogLoadError::failed("a Trino catalog update processes no batch")),
            },
        };
        if let Err(error) = result {
            self.fail(error);
        }
    }

    /// Publish into the catalog of the connection, for a `CatalogStep::Publish`. Nothing is published once the batch of
    /// the update was superseded.
    pub fn publish(&mut self, catalog: &mut Catalog, generations: &CatalogGenerations) {
        if !self.awaited(Awaiting::Publish) {
            return;
        }
        if let Err(error) = generations.check(self.ticket) {
            self.fail(error);
            return;
        }
        let publication = match &mut self.connector {
            ConnectorUpdate::Hyper(update) => update.publish(catalog),
            ConnectorUpdate::Trino(update) => update.publish(catalog),
            ConnectorUpdate::Salesforce(update) => update.publish(catalog),
        };
        self.function_script_text = publication.function_script_text;
        let catalog_changed = catalog.version() != self.version_before;
        match publication.result {
            Ok(partial) => {
                let status = match partial {
                    Some(_) => CatalogUpdateTaskStatus::PartiallySucceeded,
                    None => CatalogUpdateTaskStatus::Succeeded,
                };
                let mut outcome = CatalogUpdateOutcome::ended(status, partial);
                outcome.catalog_changed = catalog_changed;
                self.finish(outcome);
            }
            Err(error) => {
                self.fail(error);
                if let Some(outcome) = &mut self.outcome {
                    outcome.catalog_changed = catalog_changed;
                }
            }
        }
    }
}

/// The catalog entries that an update publishes into
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CatalogEntries {
    /// The descriptor of the relations
    pub relations: CatalogEntryId,
    /// The function script, none once the connection is deleted
    pub functions: Option<CatalogEntryId>,
}

impl CatalogEntries {
    /// The entry of the function script, an error without one
    pub(crate) fn function_entry(&self) -> Result<CatalogEntryId, CatalogLoadError> {
        self.functions.ok_or_else(|| CatalogLoadError::failed("the connection has no function script"))
    }
}
