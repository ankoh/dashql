//! The executions of the queries of a connection and the actions on them.
//!
//! A query moves from requested to sending, queued, running and receiving its batches to succeeded, failed or
//! cancelled. The history holds the active queries and the finished ones, and the metrics of the connection that the
//! finished queries add up to. An action changes the history in place and returns the effects that the host applies
//! afterwards: the handles that it lets go of. The result tables are Arrow tables that stay with the host, the history
//! knows them and what the host keeps of a query (its record) by their handles (`crate::handles`).

pub mod progress;

use std::collections::HashMap;

use dashql_core::error::{Error, Result};

use crate::handles::Handle;
use crate::workbook::next_revision;

use progress::{EngineProgressPayload, QueryProfileProgress};

/// The id of a query, unique among the queries of the app
pub type QueryId = u64;

/// A point in time in milliseconds since epoch
pub type Timestamp = i64;

/// The finished internal queries that the history keeps, internal queries keep no result
pub const INTERNAL_QUERY_HISTORY_LIMIT: usize = 100;

/// The status of the execution of a query
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum QueryExecutionStatus {
    /// The query was requested
    Requested = 0,
    /// The query is sent to the backend
    Sending = 2,
    /// The backend queued the query
    Queued = 3,
    /// The backend runs the query
    Running = 4,
    /// The first batch of the result arrived
    ReceivedFirstBatch = 5,
    /// All batches of the result arrived
    ReceivedAllBatches = 6,
    /// The result is processed, e.g. for a chart
    ProcessingResults = 7,
    /// The result is processed
    ProcessedResults = 8,
    /// The query succeeded
    Succeeded = 9,
    /// The query failed
    Failed = 10,
    /// The query was cancelled
    Cancelled = 11,
}

impl QueryExecutionStatus {
    /// Is the query done: succeeded, failed or cancelled?
    pub fn is_done(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}

/// The metrics of the response stream of a query, as the connector counts them
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QueryExecutionMetrics {
    /// The data bytes received
    pub total_data_bytes_received: u64,
    /// The batches received
    pub total_batches_received: u64,
    /// The rows received
    pub total_rows_received: u64,
    /// The requests that started
    pub total_query_requests_started: u64,
    /// The requests that succeeded
    pub total_query_requests_succeeded: u64,
    /// The requests that failed
    pub total_query_requests_failed: u64,
    /// The duration of all requests that failed or succeeded in milliseconds
    pub total_query_request_duration_ms: i64,
    /// The duration until the first batch in milliseconds
    pub duration_until_first_batch_ms: Option<i64>,
}

/// A progress update of a running query
#[derive(Clone, Debug, Default, PartialEq)]
pub struct QueryExecutionProgress {
    /// Is the query queued?
    pub is_queued: Option<bool>,
    /// The progress in percent, as the backend reports it
    pub progress_percent: Option<f64>,
    /// The result rows, as the backend reports them
    pub result_rows: Option<u64>,
    /// The rows the backend processed
    pub rows_processed: Option<u64>,
    /// The execution time on the backend in milliseconds
    pub execution_time_ms: Option<i64>,
    /// The metrics of the response stream
    pub metrics: QueryExecutionMetrics,
    /// The phase the engine reports, e.g. the Trino query state (QUEUED, PLANNING, RUNNING, FINISHING)
    pub phase: Option<String>,
    /// The raw progress payload of the engine, the progress model of the query in the executor turns it into the
    /// profile progress and leaves it out of the update
    pub engine_progress: Option<EngineProgressPayload>,
    /// The structured progress (stages, pipelines, the plan) of the progress model of the query
    pub profile_progress: Option<QueryProfileProgress>,
}

/// The points in time and counters of the execution of a query
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QueryMetrics {
    /// When the query was requested
    pub query_requested_at: Option<Timestamp>,
    /// When sending the query started
    pub query_sending_started_at: Option<Timestamp>,
    /// When the backend queued the query
    pub query_queued_started_at: Option<Timestamp>,
    /// When the query started running
    pub query_running_started_at: Option<Timestamp>,
    /// When the first batch arrived
    pub received_first_batch_at: Option<Timestamp>,
    /// When the latest batch arrived
    pub received_last_batch_at: Option<Timestamp>,
    /// When all batches arrived
    pub received_all_batches_at: Option<Timestamp>,
    /// When processing the result started
    pub processing_results_started_at: Option<Timestamp>,
    /// When the result was processed
    pub processed_results_at: Option<Timestamp>,
    /// When the query succeeded
    pub query_succeeded_at: Option<Timestamp>,
    /// When the query failed
    pub query_failed_at: Option<Timestamp>,
    /// When the query was cancelled
    pub query_cancelled_at: Option<Timestamp>,
    /// When the execution changed last
    pub last_updated_at: Option<Timestamp>,
    /// The progress updates received
    pub progress_updates_received: u64,
    /// The duration of the query in milliseconds, from running (or requested) until done
    pub query_duration_ms: Option<i64>,
    /// The length of the query text in UTF-16 code units, like a JavaScript string
    pub text_length: Option<u64>,
    /// The metrics of the response stream
    pub stream_metrics: QueryExecutionMetrics,
}

/// The kind of a query
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum QueryType {
    /// A query of the user, e.g. a script
    UserProvided,
    /// A catalog query on the information schema
    CatalogQueryInformationSchema,
    /// A catalog query on `pg_attribute`
    CatalogQueryPgAttribute,
    /// A catalog query on `pg_proc`
    CatalogQueryPgProc,
    /// A catalog query of Hyper in the cloud
    CatalogQueryHyperCloud,
    /// A health check of the connection
    HealthCheck,
    /// An internal query of SQLFrame, it counts for no metrics of the connection
    InternalSqlframe,
    /// A query of a cloud store
    CloudStore,
}

/// What a query is and who issued it
#[derive(Clone, Debug, PartialEq)]
pub struct QueryMetadata {
    /// The kind of the query
    pub query_type: QueryType,
    /// The title
    pub title: Option<String>,
    /// The description
    pub description: Option<String>,
    /// The issuer
    pub issuer: Option<String>,
    /// Authored by the user or the app?
    pub user_provided: bool,
    /// The workbook that issued the query. Several workbooks may share a connection, the workbook scopes the query
    /// result cache and the cleanup of the queries of the workbook.
    pub workbook_id: Option<String>,
    /// The owner of the result, e.g. a script of a workbook. A succeeded query releases the result tables of the
    /// earlier queries of its owner, the owner shows only its latest result.
    pub result_owner: Option<String>,
    /// Where a statement of a plan of workbook scripts comes from, as the host holds it (`PlannedStatement` of
    /// `@akohn/dashql`)
    pub planned: Option<serde_json::Value>,
}

impl QueryMetadata {
    /// The metadata of a query of a kind without title, issuer or owner
    pub fn new(query_type: QueryType) -> Self {
        Self {
            query_type,
            title: None,
            description: None,
            issuer: None,
            user_provided: query_type == QueryType::UserProvided,
            workbook_id: None,
            result_owner: None,
            planned: None,
        }
    }
}

/// The error of a failed or cancelled query
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueryError {
    /// The message
    pub message: String,
    /// The details, e.g. the error of the backend
    pub details: Option<String>,
}

/// The result table of a query. The table stays with the host, the history knows it by its handle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QueryResultTable {
    /// The handle of the table at the host
    pub id: Handle,
    /// The rows of the table
    pub rows: u64,
}

/// The execution of a query
#[derive(Clone, Debug, PartialEq)]
pub struct QueryExecutionState {
    /// The id of the query
    pub query_id: QueryId,
    /// The trace of the execution
    pub trace_id: u64,
    /// The query text
    pub query_text: String,
    /// What the query is and who issued it
    pub query_metadata: QueryMetadata,
    /// The status
    pub status: QueryExecutionStatus,
    /// The points in time and counters
    pub metrics: QueryMetrics,
    /// The error of a failed or cancelled query
    pub error: Option<QueryError>,
    /// The latest progress update
    pub latest_progress_update: Option<QueryExecutionProgress>,
    /// The result table, a finished query keeps it only while it is the latest result of a query of the user
    pub result_table: Option<QueryResultTable>,
    /// The key of the query in the query result cache, none if the query isn't cacheable
    pub cache_key: Option<String>,
    /// Was the result served from the query result cache instead of the backend?
    pub served_from_cache: bool,
    /// Was the cached result deleted? There is nothing left to delete then.
    pub cache_deleted: bool,
    /// When the cached result was written, none if the result didn't come from the cache. A cache hit doesn't touch
    /// the file, so this is the write time, not a last access.
    pub cached_at: Option<Timestamp>,
    /// The revision of the execution, it changes with every change
    pub revision: u64,
    /// The handle of what the host keeps of the query, e.g. its cancellation, aborted when its connection stops. The
    /// history releases it when the query leaves.
    pub handle: Option<Handle>,
}

impl QueryExecutionState {
    /// A requested query
    pub fn new(
        query_id: QueryId,
        trace_id: u64,
        query_text: impl Into<String>,
        query_metadata: QueryMetadata,
        requested_at: Timestamp,
    ) -> Self {
        let query_text = query_text.into();
        let text_length = query_text.encode_utf16().count() as u64;
        Self {
            query_id,
            trace_id,
            query_text,
            query_metadata,
            status: QueryExecutionStatus::Requested,
            metrics: QueryMetrics {
                text_length: Some(text_length),
                query_requested_at: Some(requested_at),
                last_updated_at: Some(requested_at),
                ..Default::default()
            },
            error: None,
            latest_progress_update: None,
            result_table: None,
            cache_key: None,
            served_from_cache: false,
            cache_deleted: false,
            cached_at: None,
            revision: 0,
            handle: None,
        }
    }

    /// Release the handles of a query that leaves the history
    fn release(self, effects: &mut Vec<QueryExecutionEffect>) {
        if let Some(table) = self.result_table {
            effects.push(QueryExecutionEffect::Release { handle: table.id });
        }
        if let Some(handle) = self.handle {
            effects.push(QueryExecutionEffect::Release { handle });
        }
    }

    /// The duration until now: from running, else from requested
    fn duration_until(&self, now: Timestamp) -> i64 {
        let since = self.metrics.query_running_started_at.or(self.metrics.query_requested_at).unwrap_or(now);
        now.saturating_sub(since)
    }
}

/// The metrics of the finished queries of a connection of one outcome
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConnectionQueryMetrics {
    /// The queries
    pub total_queries: u64,
    /// The batches received
    pub total_batches_received: u64,
    /// The rows received
    pub total_rows_received: u64,
    /// The time until the first batch in milliseconds, added up
    pub accumulated_time_until_first_batch: i64,
    /// The query durations in milliseconds, added up
    pub accumulated_query_duration: i64,
}

impl ConnectionQueryMetrics {
    /// Add a finished query
    fn add(&mut self, query: &QueryMetrics) {
        let stream = &query.stream_metrics;
        self.total_queries = self.total_queries.saturating_add(1);
        self.total_batches_received = self.total_batches_received.saturating_add(stream.total_batches_received);
        self.total_rows_received = self.total_rows_received.saturating_add(stream.total_rows_received);
        self.accumulated_time_until_first_batch = self
            .accumulated_time_until_first_batch
            .saturating_add(stream.duration_until_first_batch_ms.unwrap_or(0));
        self.accumulated_query_duration =
            self.accumulated_query_duration.saturating_add(query.query_duration_ms.unwrap_or(0));
    }
}

/// The metrics of the finished queries of a connection, internal queries of SQLFrame don't count
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ConnectionMetrics {
    /// The queries that succeeded
    pub successful_queries: ConnectionQueryMetrics,
    /// The queries that were cancelled
    pub canceled_queries: ConnectionQueryMetrics,
    /// The queries that failed
    pub failed_queries: ConnectionQueryMetrics,
}

/// An action on the query executions. Every action carries the time it happened at, the history reads no clock.
#[derive(Clone, Debug, PartialEq)]
pub enum QueryExecutionAction {
    /// Start tracking a requested query, its id must be new
    ExecuteQuery { state: Box<QueryExecutionState> },
    /// The query is sent to the backend
    QuerySending { query_id: QueryId, now: Timestamp },
    /// The backend runs the query
    QueryRunning { query_id: QueryId, now: Timestamp },
    /// The backend reported progress. A progress without profile progress keeps the one of the previous update. A
    /// query that is queued while it is sent becomes queued.
    QueryProgressUpdated { query_id: QueryId, progress: Box<QueryExecutionProgress>, now: Timestamp },
    /// A batch of the result arrived
    QueryReceivedBatch { query_id: QueryId, metrics: QueryExecutionMetrics, now: Timestamp },
    /// All batches arrived, the result is complete
    QueryReceivedAllBatches {
        query_id: QueryId,
        table: QueryResultTable,
        metrics: QueryExecutionMetrics,
        now: Timestamp,
    },
    /// Processing the result started
    QueryProcessingResults { query_id: QueryId, now: Timestamp },
    /// The result is processed
    QueryProcessedResults { query_id: QueryId, now: Timestamp },
    /// The query succeeded
    QuerySucceeded { query_id: QueryId, now: Timestamp },
    /// The query failed, with the stream metrics so far if the connector has them
    QueryFailed { query_id: QueryId, error: QueryError, metrics: Option<QueryExecutionMetrics>, now: Timestamp },
    /// The query was cancelled, with the stream metrics so far if the connector has them
    QueryCancelled { query_id: QueryId, error: QueryError, metrics: Option<QueryExecutionMetrics>, now: Timestamp },
    /// The query result cache knows the query, of an active or a finished query: its key, whether the result came
    /// from the cache and when the cached result was written (unchanged without)
    QueryCacheRecorded { query_id: QueryId, cache_key: String, served_from_cache: bool, cached_at: Option<Timestamp> },
    /// The cached result of an active or a finished query was deleted
    QueryCacheDeleted { query_id: QueryId },
}

impl QueryExecutionAction {
    /// The query of the action
    pub fn query_id(&self) -> QueryId {
        match self {
            QueryExecutionAction::ExecuteQuery { state } => state.query_id,
            QueryExecutionAction::QuerySending { query_id, .. }
            | QueryExecutionAction::QueryRunning { query_id, .. }
            | QueryExecutionAction::QueryProgressUpdated { query_id, .. }
            | QueryExecutionAction::QueryReceivedBatch { query_id, .. }
            | QueryExecutionAction::QueryReceivedAllBatches { query_id, .. }
            | QueryExecutionAction::QueryProcessingResults { query_id, .. }
            | QueryExecutionAction::QueryProcessedResults { query_id, .. }
            | QueryExecutionAction::QuerySucceeded { query_id, .. }
            | QueryExecutionAction::QueryFailed { query_id, .. }
            | QueryExecutionAction::QueryCancelled { query_id, .. }
            | QueryExecutionAction::QueryCacheRecorded { query_id, .. }
            | QueryExecutionAction::QueryCacheDeleted { query_id } => *query_id,
        }
    }
}

/// What the host must do after an action
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QueryExecutionEffect {
    /// Abort a handle: the record of a query that was active when its history was cleared
    Abort { handle: Handle, reason: &'static str },
    /// Release a handle: a result table that nothing shows anymore, the record of a query that left
    Release { handle: Handle },
}

/// The outcome of an action
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct QueryExecutionOutcome {
    /// Did the action change the history? An action on an unknown query changes nothing.
    pub changed: bool,
    /// The effects for the host, in order
    pub effects: Vec<QueryExecutionEffect>,
    /// The queries whose result tables the history released for a later result of their owner. The history decides
    /// which result of an owner is the latest, the host lets go of what it derived from the others, e.g. their
    /// computations.
    pub superseded: Vec<QueryId>,
}

/// The active and the finished queries of a connection
#[derive(Clone, Debug)]
pub struct QueryExecutionHistory {
    /// The active queries
    queries_active: HashMap<QueryId, QueryExecutionState>,
    /// The active queries in the order they started
    queries_active_ordered: Vec<QueryId>,
    /// The finished queries
    queries_finished: HashMap<QueryId, QueryExecutionState>,
    /// The finished queries in the order they finished
    queries_finished_ordered: Vec<QueryId>,
    /// Changes whenever a query starts or finishes
    snapshot_queries_active_finished: u64,
    /// The metrics of the finished queries
    metrics: ConnectionMetrics,
    /// The revision of the history, it changes with every change
    revision: u64,
    /// The finished internal queries that the history keeps
    internal_limit: usize,
}

impl Default for QueryExecutionHistory {
    fn default() -> Self {
        Self::with_internal_limit(INTERNAL_QUERY_HISTORY_LIMIT)
    }
}

impl QueryExecutionHistory {
    /// An empty history
    pub fn new() -> Self {
        Self::default()
    }

    /// An empty history that keeps a number of finished internal queries
    pub fn with_internal_limit(internal_limit: usize) -> Self {
        Self {
            queries_active: HashMap::new(),
            queries_active_ordered: Vec::new(),
            queries_finished: HashMap::new(),
            queries_finished_ordered: Vec::new(),
            snapshot_queries_active_finished: 0,
            metrics: ConnectionMetrics::default(),
            revision: 0,
            internal_limit,
        }
    }

    /// The active query with an id
    pub fn active(&self, query_id: QueryId) -> Option<&QueryExecutionState> {
        self.queries_active.get(&query_id)
    }

    /// The finished query with an id
    pub fn finished(&self, query_id: QueryId) -> Option<&QueryExecutionState> {
        self.queries_finished.get(&query_id)
    }

    /// The active or finished query with an id
    pub fn query(&self, query_id: QueryId) -> Option<&QueryExecutionState> {
        self.active(query_id).or_else(|| self.finished(query_id))
    }

    /// The ids of the active queries in the order they started
    pub fn active_ids(&self) -> &[QueryId] {
        &self.queries_active_ordered
    }

    /// The ids of the finished queries in the order they finished
    pub fn finished_ids(&self) -> &[QueryId] {
        &self.queries_finished_ordered
    }

    /// A counter that changes whenever a query starts or finishes
    pub fn snapshot_queries_active_finished(&self) -> u64 {
        self.snapshot_queries_active_finished
    }

    /// The metrics of the finished queries
    pub fn metrics(&self) -> &ConnectionMetrics {
        &self.metrics
    }

    /// The revision of the history, it changes with every change
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Apply an action. A failed action leaves the history unchanged, an action on an unknown query changes nothing:
    /// late actions are expected, e.g. a terminal action of a query that finished already.
    pub fn apply(&mut self, action: QueryExecutionAction) -> Result<QueryExecutionOutcome> {
        let mut outcome = QueryExecutionOutcome::default();
        match action {
            QueryExecutionAction::ExecuteQuery { state } => {
                let query_id = state.query_id;
                if self.query(query_id).is_some() {
                    return Err(Error::invalid_argument(format!("the query {query_id} exists already")));
                }
                self.queries_active.insert(query_id, *state);
                self.queries_active_ordered.push(query_id);
                self.snapshot_queries_active_finished += 1;
                outcome.changed = true;
            }
            // The cache bookkeeping can arrive after the query finished: the write of a result runs after the query,
            // and the cache of a finished result can be deleted
            QueryExecutionAction::QueryCacheRecorded { query_id, cache_key, served_from_cache, cached_at } => {
                if let Some(query) = self.query_mut(query_id) {
                    query.cache_key = Some(cache_key);
                    query.served_from_cache = served_from_cache;
                    query.cached_at = cached_at.or(query.cached_at);
                    query.revision = next_revision();
                    outcome.changed = true;
                }
            }
            QueryExecutionAction::QueryCacheDeleted { query_id } => {
                if let Some(query) = self.query_mut(query_id) {
                    query.cache_deleted = true;
                    query.revision = next_revision();
                    outcome.changed = true;
                }
            }
            action => self.apply_to_active(action, &mut outcome),
        }
        if outcome.changed {
            self.revision = next_revision();
        }
        Ok(outcome)
    }

    /// Drop every query and the metrics, e.g. of a connection that is reset or deleted. The active queries are
    /// aborted with the reason, the host stops them at the backend, and the handles of all queries are released.
    pub fn clear(&mut self, reason: &'static str) -> QueryExecutionOutcome {
        let active = std::mem::take(&mut self.queries_active_ordered);
        let finished = std::mem::take(&mut self.queries_finished_ordered);
        let mut queries_active = std::mem::take(&mut self.queries_active);
        let mut queries_finished = std::mem::take(&mut self.queries_finished);
        let mut outcome = QueryExecutionOutcome { changed: true, ..Default::default() };
        for handle in active.iter().filter_map(|query_id| queries_active.get(query_id).and_then(|query| query.handle)) {
            outcome.effects.push(QueryExecutionEffect::Abort { handle, reason });
        }
        for query_id in active.iter().chain(finished.iter()) {
            if let Some(query) = queries_active.remove(query_id).or_else(|| queries_finished.remove(query_id)) {
                query.release(&mut outcome.effects);
            }
        }
        self.metrics = ConnectionMetrics::default();
        self.snapshot_queries_active_finished += 1;
        self.revision = next_revision();
        outcome
    }

    /// The active or finished query with an id, for a change
    fn query_mut(&mut self, query_id: QueryId) -> Option<&mut QueryExecutionState> {
        match self.queries_active.get_mut(&query_id) {
            Some(query) => Some(query),
            None => self.queries_finished.get_mut(&query_id),
        }
    }

    /// Apply an action on an active query
    fn apply_to_active(&mut self, action: QueryExecutionAction, outcome: &mut QueryExecutionOutcome) {
        let query_id = match &action {
            QueryExecutionAction::QuerySending { query_id, .. }
            | QueryExecutionAction::QueryRunning { query_id, .. }
            | QueryExecutionAction::QueryProgressUpdated { query_id, .. }
            | QueryExecutionAction::QueryReceivedBatch { query_id, .. }
            | QueryExecutionAction::QueryReceivedAllBatches { query_id, .. }
            | QueryExecutionAction::QueryProcessingResults { query_id, .. }
            | QueryExecutionAction::QueryProcessedResults { query_id, .. }
            | QueryExecutionAction::QuerySucceeded { query_id, .. }
            | QueryExecutionAction::QueryFailed { query_id, .. }
            | QueryExecutionAction::QueryCancelled { query_id, .. } => *query_id,
            QueryExecutionAction::ExecuteQuery { .. }
            | QueryExecutionAction::QueryCacheRecorded { .. }
            | QueryExecutionAction::QueryCacheDeleted { .. } => return,
        };
        let Some(query) = self.queries_active.get_mut(&query_id) else {
            // A result that no active query takes is released
            if let QueryExecutionAction::QueryReceivedAllBatches { table, .. } = action {
                outcome.effects.push(QueryExecutionEffect::Release { handle: table.id });
            }
            return;
        };
        query.revision = next_revision();
        outcome.changed = true;
        match action {
            QueryExecutionAction::QuerySending { now, .. } => {
                query.status = QueryExecutionStatus::Sending;
                query.metrics.last_updated_at = Some(now);
                query.metrics.query_sending_started_at = Some(now);
            }
            QueryExecutionAction::QueryRunning { now, .. } => {
                query.status = QueryExecutionStatus::Running;
                query.metrics.last_updated_at = Some(now);
                query.metrics.query_running_started_at = Some(now);
            }
            QueryExecutionAction::QueryProgressUpdated { progress, now, .. } => {
                let mut progress = *progress;
                // An update without structured progress keeps the last one, e.g. while the core loads
                if progress.profile_progress.is_none() {
                    progress.profile_progress =
                        query.latest_progress_update.take().and_then(|previous| previous.profile_progress);
                }
                // Is the query queued for the first time?
                if progress.is_queued == Some(true) && query.status == QueryExecutionStatus::Sending {
                    query.status = QueryExecutionStatus::Queued;
                    query.metrics.query_queued_started_at = Some(now);
                }
                query.latest_progress_update = Some(progress);
                query.metrics.last_updated_at = Some(now);
                query.metrics.progress_updates_received = query.metrics.progress_updates_received.saturating_add(1);
            }
            QueryExecutionAction::QueryReceivedBatch { metrics, now, .. } => {
                query.status = QueryExecutionStatus::ReceivedFirstBatch;
                query.metrics.received_first_batch_at.get_or_insert(now);
                query.metrics.received_last_batch_at = Some(now);
                query.metrics.last_updated_at = Some(now);
                query.metrics.stream_metrics = metrics;
            }
            QueryExecutionAction::QueryReceivedAllBatches { table, metrics, now, .. } => {
                query.status = QueryExecutionStatus::ReceivedAllBatches;
                query.metrics.last_updated_at = Some(now);
                query.metrics.received_all_batches_at = Some(now);
                query.metrics.stream_metrics = metrics;
                // A result that arrives again replaces the earlier one
                if let Some(previous) = query.result_table.replace(table) {
                    if previous.id != table.id {
                        outcome.effects.push(QueryExecutionEffect::Release { handle: previous.id });
                    }
                }
            }
            QueryExecutionAction::QueryProcessingResults { now, .. } => {
                query.status = QueryExecutionStatus::ProcessingResults;
                query.metrics.last_updated_at = Some(now);
                query.metrics.processing_results_started_at = Some(now);
            }
            QueryExecutionAction::QueryProcessedResults { now, .. } => {
                query.status = QueryExecutionStatus::ProcessedResults;
                query.metrics.last_updated_at = Some(now);
                query.metrics.processed_results_at = Some(now);
            }
            QueryExecutionAction::QuerySucceeded { now, .. } => {
                query.status = QueryExecutionStatus::Succeeded;
                query.metrics.query_duration_ms = Some(query.duration_until(now));
                query.metrics.last_updated_at = Some(now);
                query.metrics.query_succeeded_at = Some(now);
                self.finish_query(query_id, outcome);
            }
            QueryExecutionAction::QueryCancelled { error, metrics, now, .. } => {
                query.status = QueryExecutionStatus::Cancelled;
                query.error = Some(error);
                query.metrics.query_duration_ms = Some(query.duration_until(now));
                query.metrics.last_updated_at = Some(now);
                query.metrics.query_cancelled_at = Some(now);
                if let Some(metrics) = metrics {
                    query.metrics.stream_metrics = metrics;
                }
                self.finish_query(query_id, outcome);
            }
            QueryExecutionAction::QueryFailed { error, metrics, now, .. } => {
                query.status = QueryExecutionStatus::Failed;
                query.error = Some(error);
                query.metrics.query_duration_ms = Some(query.duration_until(now));
                query.metrics.last_updated_at = Some(now);
                query.metrics.query_failed_at = Some(now);
                if let Some(metrics) = metrics {
                    query.metrics.stream_metrics = metrics;
                }
                self.finish_query(query_id, outcome);
            }
            QueryExecutionAction::ExecuteQuery { .. }
            | QueryExecutionAction::QueryCacheRecorded { .. }
            | QueryExecutionAction::QueryCacheDeleted { .. } => {}
        }
    }

    /// Move a done query to the finished queries and add it to the metrics of the connection.
    ///
    /// The succeeded queries of the user keep their result tables for the views of their results. Internal queries
    /// return their results to their callers and keep only their metrics. A query that was cancelled or failed keeps no
    /// result either, e.g. one that was cancelled while its result was analyzed: the host dropped its computation. A
    /// succeeded query with a result owner releases the result tables of the other queries of its owner, except for a
    /// later one, like the latest result of a script. The queries that lose their result this way are superseded, the
    /// host drops their computations.
    fn finish_query(&mut self, query_id: QueryId, outcome: &mut QueryExecutionOutcome) {
        let Some(mut query) = self.queries_active.remove(&query_id) else {
            return;
        };
        self.queries_active_ordered.retain(|id| *id != query_id);
        let user_provided = query.query_metadata.query_type == QueryType::UserProvided;
        if !user_provided || query.status != QueryExecutionStatus::Succeeded {
            if let Some(table) = query.result_table.take() {
                outcome.effects.push(QueryExecutionEffect::Release { handle: table.id });
            }
        }

        // The latest result of an owner stays, the query id tells which one is later
        if let (true, QueryExecutionStatus::Succeeded, Some(_), Some(owner)) =
            (user_provided, query.status, query.result_table, query.query_metadata.result_owner.as_deref())
        {
            let mut keep_own = true;
            for other_id in &self.queries_finished_ordered {
                let Some(other) = self.queries_finished.get_mut(other_id) else {
                    continue;
                };
                if *other_id == query_id || other.query_metadata.result_owner.as_deref() != Some(owner) {
                    continue;
                }
                let Some(table) = other.result_table else {
                    continue;
                };
                // A later result stays, the earlier query finished after it
                if *other_id > query_id {
                    keep_own = false;
                } else {
                    other.result_table = None;
                    other.revision = next_revision();
                    outcome.effects.push(QueryExecutionEffect::Release { handle: table.id });
                    outcome.superseded.push(*other_id);
                }
            }
            if !keep_own {
                if let Some(table) = query.result_table.take() {
                    outcome.effects.push(QueryExecutionEffect::Release { handle: table.id });
                    outcome.superseded.push(query_id);
                }
            }
        }

        // Internal queries of SQLFrame don't count for the connection
        match query.status {
            _ if query.query_metadata.query_type == QueryType::InternalSqlframe => {}
            QueryExecutionStatus::Succeeded => self.metrics.successful_queries.add(&query.metrics),
            QueryExecutionStatus::Cancelled => self.metrics.canceled_queries.add(&query.metrics),
            QueryExecutionStatus::Failed => self.metrics.failed_queries.add(&query.metrics),
            _ => {}
        }

        self.queries_finished.insert(query_id, query);
        self.queries_finished_ordered.push(query_id);
        self.snapshot_queries_active_finished += 1;

        // The oldest internal queries leave beyond the limit
        let is_internal = |query: Option<&QueryExecutionState>| {
            query.is_none_or(|query| query.query_metadata.query_type != QueryType::UserProvided)
        };
        let internal = self.queries_finished_ordered.iter().filter(|id| is_internal(self.queries_finished.get(id))).count();
        let mut excess = internal.saturating_sub(self.internal_limit);
        let finished = &mut self.queries_finished;
        self.queries_finished_ordered.retain(|id| {
            if excess == 0 || !is_internal(finished.get(id)) {
                return true;
            }
            if let Some(query) = finished.remove(id) {
                query.release(&mut outcome.effects);
            }
            excess -= 1;
            false
        });
    }
}
