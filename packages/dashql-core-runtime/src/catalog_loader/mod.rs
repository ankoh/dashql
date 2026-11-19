//! The catalog loader: the SQL that describes the catalog of a connection, the descriptors and table updates that the
//! answers become, and when to update which catalog.
//!
//! The connector of the connection makes the steps of an update (`Connector::catalog_update`,
//! `ConnectorCatalogUpdate`): the queries to run, a fresh channel, the HTTP requests to send and the moment to publish
//! into the catalog, and it takes their answers; it parses its catalog batches itself. `CatalogUpdate::run` runs the
//! steps over a `CatalogUpdateHost` that answers them, the service of the loader over its host and the tests over a
//! fake, and knows no connector. The scheduler (`CatalogLoader`) decides when a catalog is described, refreshed or
//! asked about the relations of executed statements and hands out the updates to start. The connection keeps the state
//! of the updates (`connections::CatalogUpdates`), the host reports every step as a `ConnectionAction`.

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
use std::future::Future;

use arrow_array::RecordBatch;
use arrow_schema::ArrowError;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogVersion};

use crate::connections::{
    CatalogUpdateTask, CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionAction, ConnectionChannel, ConnectionState,
    DetailedError, RelationName, Timestamp,
};
use crate::workbook::CatalogHandle;
use crate::http::{HttpRequest, HttpResponse};
use crate::query::QueryType;

pub use batch::{CatalogBatch, CatalogBatchEntry, CatalogGenerations, CatalogTicket};
pub use scheduler::{CatalogLoader, CatalogLoaderCommand, CatalogLoaderConnection, CatalogSchedule};
pub use service::{CatalogLoaderHost, CatalogLoaderService, FollowedConnection, QueryBatches};

/// The reason of an update whose connection is gone or got another catalog, or whose batch a newer one superseded
pub const STALE_MESSAGE: &str = "Catalog refresh was cancelled or superseded";

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
pub enum ConnectorStep {
    /// Run the queries on the connection at the same time, `answer_queries` takes the answers in their order
    Query(Vec<CatalogQuery>),
    /// Refresh the credentials of the channel of the connection that are about to expire
    /// (`ConnectionChannel::fresh`), `answer_channel` takes the channel
    FreshChannel,
    /// Send the requests at the same time, `answer_fetch` takes the responses in their order
    Fetch(Vec<HttpRequest>),
    /// Publish into the catalog of the connection with `publish`
    Publish,
    /// Finished without publishing, with the error of the databases that failed
    Done { partial: Option<String> },
}

/// The update of the catalog of a connection by its connector, created by `Connector::catalog_update`.
/// `CatalogUpdate::run` asks it for the next step and hands it the answer of the step, an answer that the update didn't
/// ask for fails the update.
pub trait ConnectorCatalogUpdate: fmt::Debug {
    /// The next step
    fn step(&mut self) -> Result<ConnectorStep, CatalogLoadError>;

    /// The answers of the queries of a `ConnectorStep::Query`, in their order
    fn answer_queries(&mut self, _answers: Vec<QueryAnswer>) -> Result<(), CatalogLoadError> {
        Err(CatalogLoadError::failed("the catalog update runs no queries"))
    }

    /// The fresh channel of a `ConnectorStep::FreshChannel`, none if the connection has none
    fn answer_channel(&mut self, _channel: Option<&ConnectionChannel>) -> Result<(), CatalogLoadError> {
        Err(CatalogLoadError::failed("the catalog update asks for no channel"))
    }

    /// The responses of the requests of a `ConnectorStep::Fetch`, in their order, or the error of a request that got
    /// none
    fn answer_fetch(&mut self, _responses: Vec<Result<HttpResponse, String>>) -> Result<(), CatalogLoadError> {
        Err(CatalogLoadError::failed("the catalog update sends no requests"))
    }

    /// Publish into the catalog of the connection, for a `ConnectorStep::Publish`
    fn publish(&mut self, catalog: &mut Catalog) -> Publication;

    /// The warnings so far, for the log of the host
    fn take_warnings(&mut self) -> Vec<String> {
        Vec::new()
    }
}

/// What a publication did
#[derive(Debug)]
pub struct Publication {
    /// The text of the function script, once its descriptor is published
    pub function_script_text: Option<String>,
    /// The error of the databases that failed if the publication succeeded, the error that stopped it otherwise
    pub result: Result<Option<String>, CatalogLoadError>,
}

impl Publication {
    /// A publication without a function script
    pub fn of(result: Result<Option<String>, CatalogLoadError>) -> Self {
        Self { function_script_text: None, result }
    }
}

/// What a running update asks of the loader: the answers of its steps, and whether it may go on. A step answers None
/// once the update was cancelled.
pub trait CatalogUpdateHost {
    /// Why the update can't go on, none while it may: it was cancelled, or a newer batch of its catalog superseded it
    fn stopped(&self, ticket: CatalogTicket) -> Option<CatalogLoadError>;
    /// Run the metadata queries at the same time, the answers in their order
    fn run_queries(&self, queries: &[CatalogQuery]) -> impl Future<Output = Option<Vec<QueryAnswer>>>;
    /// The channel of the connection with fresh credentials (`ConnectionChannel::fresh`), none if it has none, or the
    /// error of the refresh
    fn fresh_channel(&self) -> impl Future<Output = Option<Result<Option<ConnectionChannel>, String>>>;
    /// Send the requests at the same time, the responses in their order or the error of a request that got none
    fn fetch(&self, requests: &[HttpRequest]) -> impl Future<Output = Option<Vec<Result<HttpResponse, String>>>>;
    /// The catalog to publish into, or why the update may not publish, e.g. its connection dropped it
    fn catalog(&self) -> Result<CatalogHandle, CatalogLoadError>;
}

/// An update of the catalog of a connection that began
#[derive(Debug)]
pub struct CatalogUpdate {
    /// The task of the update, the connection registers it (`ConnectionAction::UpdateCatalog`)
    pub task: CatalogUpdateTask,
    /// The generation of the catalog that the update began with
    ticket: CatalogTicket,
    /// The version of the catalog when the update began
    version_before: CatalogVersion,
    /// The update of the connector
    connector: Box<dyn ConnectorCatalogUpdate>,
}

impl CatalogUpdate {
    /// Begin an update of the catalog of a connection: all of it, or the relations of executed statements. It
    /// supersedes the pending batches of the catalog.
    pub fn start(
        connection: &ConnectionState,
        task_id: u32,
        relations: Option<Vec<RelationName>>,
        generations: &mut CatalogGenerations,
        now: Timestamp,
    ) -> Result<Self, CatalogLoadError> {
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
        let connector = connection.connector_type().connector().catalog_update(connection.details(), entries, relations, now);
        Ok(Self { task, ticket: generations.begin(catalog_id), version_before, connector })
    }

    /// The generation of the catalog that the update began with
    pub fn ticket(&self) -> CatalogTicket {
        self.ticket
    }

    /// Run the steps of the connector over the host to the end of the update. Before every step the host says whether
    /// the update may go on; a cancelled step stops it. Nothing is published once the update stopped.
    pub async fn run<H: CatalogUpdateHost>(mut self, host: &H) -> CatalogUpdateOutcome {
        let ticket = self.ticket;
        let stopped = |host: &H| host.stopped(ticket).unwrap_or_else(|| CatalogLoadError::cancelled(STALE_MESSAGE));
        let mut function_script_text = None;
        let mut catalog_changed = false;
        let result = loop {
            if let Some(error) = host.stopped(self.ticket) {
                break Err(error);
            }
            let answered = match self.connector.step() {
                Err(error) => Err(error),
                Ok(ConnectorStep::Done { partial }) => break Ok(partial),
                Ok(ConnectorStep::Query(queries)) => match host.run_queries(&queries).await {
                    None => break Err(stopped(host)),
                    Some(answers) => self.connector.answer_queries(answers),
                },
                Ok(ConnectorStep::FreshChannel) => match host.fresh_channel().await {
                    None => break Err(stopped(host)),
                    Some(Ok(channel)) => self.connector.answer_channel(channel.as_ref()),
                    Some(Err(error)) => Err(CatalogLoadError::Failed(error)),
                },
                Ok(ConnectorStep::Fetch(requests)) => match host.fetch(&requests).await {
                    None => break Err(stopped(host)),
                    Some(responses) => self.connector.answer_fetch(responses),
                },
                Ok(ConnectorStep::Publish) => {
                    let catalog = match host.catalog() {
                        Ok(catalog) => catalog,
                        Err(error) => break Err(error),
                    };
                    let Ok(mut catalog) = catalog.try_borrow_mut() else {
                        break Err(CatalogLoadError::failed("the catalog is in use"));
                    };
                    let publication = self.connector.publish(&mut catalog);
                    catalog_changed = catalog.version() != self.version_before;
                    function_script_text = publication.function_script_text;
                    break publication.result;
                }
            };
            if let Err(error) = answered {
                break Err(error);
            }
        };
        let (status, error) = match result {
            Ok(None) => (CatalogUpdateTaskStatus::Succeeded, None),
            Ok(Some(partial)) => (CatalogUpdateTaskStatus::PartiallySucceeded, Some(partial)),
            Err(CatalogLoadError::Cancelled(message)) => (CatalogUpdateTaskStatus::Cancelled, Some(message)),
            Err(CatalogLoadError::Failed(message)) => (CatalogUpdateTaskStatus::Failed, Some(message)),
        };
        CatalogUpdateOutcome {
            status,
            error,
            catalog_changed,
            function_script_text,
            warnings: self.connector.take_warnings(),
        }
    }
}

/// The catalog entries that an update publishes into
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogEntries {
    /// The descriptor of the relations
    pub relations: CatalogEntryId,
    /// The function script, none once the connection is deleted
    pub functions: Option<CatalogEntryId>,
}

impl CatalogEntries {
    /// The entry of the function script, an error without one
    pub fn function_entry(&self) -> Result<CatalogEntryId, CatalogLoadError> {
        self.functions.ok_or_else(|| CatalogLoadError::failed("the connection has no function script"))
    }
}
