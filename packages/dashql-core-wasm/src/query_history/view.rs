//! The views of a query history: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`) with
//! TypeScript declarations in the generated `.d.ts` (`tsify`). See docs/wip/runtime_projection.md.
//!
//! The views of the queries are the same for the history of a connection and a history of its own, e.g. the one of
//! the shell. Ids, revisions and times are numbers, a missing value is null. The counters of the stream metrics cross
//! as numbers that the host may count with fractions, Rust rounds them down.

use dashql_core_runtime::query::{
    self as rt, ConnectionQueryMetrics, QueryExecutionHistory, QueryExecutionMetrics, QueryExecutionProgress, QueryExecutionState,
    QueryMetadata,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::views::app_enum;

app_enum! {
    "The status of the execution of a query"
    QueryExecutionStatus: rt::QueryExecutionStatus {
        REQUESTED = 0 => Requested,
        SENDING = 2 => Sending,
        QUEUED = 3 => Queued,
        RUNNING = 4 => Running,
        RECEIVED_FIRST_BATCH = 5 => ReceivedFirstBatch,
        RECEIVED_ALL_BATCHES = 6 => ReceivedAllBatches,
        PROCESSING_RESULTS = 7 => ProcessingResults,
        PROCESSED_RESULTS = 8 => ProcessedResults,
        SUCCEEDED = 9 => Succeeded,
        FAILED = 10 => Failed,
        CANCELLED = 11 => Cancelled,
    }
}

app_enum! {
    "The kind of a query"
    QueryType: rt::QueryType {
        USER_PROVIDED = 0 => UserProvided,
        CATALOG_QUERY_INFORMATION_SCHEMA = 1 => CatalogQueryInformationSchema,
        CATALOG_QUERY_PG_ATTRIBUTE = 2 => CatalogQueryPgAttribute,
        CATALOG_QUERY_PG_PROC = 3 => CatalogQueryPgProc,
        CATALOG_QUERY_HYPER_CLOUD = 4 => CatalogQueryHyperCloud,
        HEALTH_CHECK = 5 => HealthCheck,
        INTERNAL_SQLFRAME = 6 => InternalSqlframe,
        CLOUD_STORE = 7 => CloudStore,
    }
}

/// A count of the host, rounded down and at least 0
fn count(value: f64) -> u64 {
    value.max(0.0) as u64
}

/// The metrics of the response stream of a query, as the connector counts them
#[derive(Clone, Debug, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryStreamMetrics {
    pub total_data_bytes_received: f64,
    pub total_batches_received: f64,
    pub total_rows_received: f64,
    pub total_query_requests_started: f64,
    pub total_query_requests_succeeded: f64,
    pub total_query_requests_failed: f64,
    pub total_query_request_duration_ms: f64,
    pub duration_until_first_batch_ms: Option<f64>,
}

impl From<&QueryExecutionMetrics> for QueryStreamMetrics {
    fn from(m: &QueryExecutionMetrics) -> Self {
        QueryStreamMetrics {
            total_data_bytes_received: m.total_data_bytes_received as f64,
            total_batches_received: m.total_batches_received as f64,
            total_rows_received: m.total_rows_received as f64,
            total_query_requests_started: m.total_query_requests_started as f64,
            total_query_requests_succeeded: m.total_query_requests_succeeded as f64,
            total_query_requests_failed: m.total_query_requests_failed as f64,
            total_query_request_duration_ms: m.total_query_request_duration_ms as f64,
            duration_until_first_batch_ms: m.duration_until_first_batch_ms.map(|ms| ms as f64),
        }
    }
}

impl From<QueryStreamMetrics> for QueryExecutionMetrics {
    fn from(m: QueryStreamMetrics) -> Self {
        QueryExecutionMetrics {
            total_data_bytes_received: count(m.total_data_bytes_received),
            total_batches_received: count(m.total_batches_received),
            total_rows_received: count(m.total_rows_received),
            total_query_requests_started: count(m.total_query_requests_started),
            total_query_requests_succeeded: count(m.total_query_requests_succeeded),
            total_query_requests_failed: count(m.total_query_requests_failed),
            total_query_request_duration_ms: m.total_query_request_duration_ms as i64,
            duration_until_first_batch_ms: m.duration_until_first_batch_ms.map(|ms| ms as i64),
        }
    }
}

/// The plain fields of a progress update of a query. The structured progress stays with the host.
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryProgressView {
    pub is_queued: Option<bool>,
    pub progress_percent: Option<f64>,
    pub result_rows: Option<f64>,
    pub rows_processed: Option<f64>,
    pub execution_time_ms: Option<f64>,
    /// The metrics of the response stream, none counts nothing
    #[tsify(optional, type = "QueryStreamMetrics | null")]
    pub metrics: Option<QueryStreamMetrics>,
    #[tsify(optional, type = "string | null")]
    pub phase: Option<String>,
}

impl From<QueryProgressView> for QueryExecutionProgress {
    fn from(p: QueryProgressView) -> Self {
        QueryExecutionProgress {
            is_queued: p.is_queued,
            progress_percent: p.progress_percent,
            result_rows: p.result_rows.map(count),
            rows_processed: p.rows_processed.map(count),
            execution_time_ms: p.execution_time_ms.map(|ms| ms as i64),
            metrics: p.metrics.map(Into::into).unwrap_or_default(),
            phase: p.phase,
            engine_progress: None,
            profile_progress: None,
        }
    }
}

/// What a query is and who issued it. A planned statement stays with the host.
#[derive(Clone, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryMetadataView {
    #[tsify(type = "QueryType")]
    pub query_type: QueryType,
    pub title: Option<String>,
    pub description: Option<String>,
    pub issuer: Option<String>,
    pub user_provided: bool,
    #[tsify(optional)]
    pub workbook_id: Option<String>,
    #[tsify(optional)]
    pub result_owner: Option<String>,
}

impl From<QueryMetadataView> for QueryMetadata {
    fn from(m: QueryMetadataView) -> Self {
        let mut metadata = QueryMetadata::new(m.query_type.into());
        metadata.title = m.title;
        metadata.description = m.description;
        metadata.issuer = m.issuer;
        metadata.user_provided = m.user_provided;
        metadata.workbook_id = m.workbook_id;
        metadata.result_owner = m.result_owner;
        metadata
    }
}

/// The points in time of a query in milliseconds since epoch and its counters
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryMetricsView {
    pub query_requested_at: Option<i64>,
    pub query_sending_started_at: Option<i64>,
    pub query_queued_started_at: Option<i64>,
    pub query_running_started_at: Option<i64>,
    pub received_first_batch_at: Option<i64>,
    pub received_last_batch_at: Option<i64>,
    pub received_all_batches_at: Option<i64>,
    pub processing_results_started_at: Option<i64>,
    pub processed_results_at: Option<i64>,
    pub query_succeeded_at: Option<i64>,
    pub query_failed_at: Option<i64>,
    pub query_cancelled_at: Option<i64>,
    pub last_updated_at: Option<i64>,
    pub progress_updates_received: u64,
    pub query_duration_ms: Option<i64>,
    pub text_length: Option<u64>,
    pub stream_metrics: QueryStreamMetrics,
}

/// The error of a failed or cancelled query
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryErrorView {
    pub message: String,
    pub details: Option<String>,
}

/// The result table of a query, the host keeps it under its id
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryResultTableView {
    pub id: u64,
    pub rows: u64,
}

/// The plain fields of a query. The text, the metadata and the progress stay with the host.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryView {
    pub query_id: u64,
    #[tsify(type = "QueryExecutionStatus")]
    pub status: QueryExecutionStatus,
    pub metrics: QueryMetricsView,
    pub error: Option<QueryErrorView>,
    pub result_table: Option<QueryResultTableView>,
    pub cache_key: Option<String>,
    pub served_from_cache: bool,
    pub cache_deleted: bool,
    pub cached_at: Option<i64>,
    pub revision: u64,
}

impl From<&QueryExecutionState> for QueryView {
    fn from(query: &QueryExecutionState) -> Self {
        let m = &query.metrics;
        QueryView {
            query_id: query.query_id,
            status: query.status.into(),
            metrics: QueryMetricsView {
                query_requested_at: m.query_requested_at,
                query_sending_started_at: m.query_sending_started_at,
                query_queued_started_at: m.query_queued_started_at,
                query_running_started_at: m.query_running_started_at,
                received_first_batch_at: m.received_first_batch_at,
                received_last_batch_at: m.received_last_batch_at,
                received_all_batches_at: m.received_all_batches_at,
                processing_results_started_at: m.processing_results_started_at,
                processed_results_at: m.processed_results_at,
                query_succeeded_at: m.query_succeeded_at,
                query_failed_at: m.query_failed_at,
                query_cancelled_at: m.query_cancelled_at,
                last_updated_at: m.last_updated_at,
                progress_updates_received: m.progress_updates_received,
                query_duration_ms: m.query_duration_ms,
                text_length: m.text_length,
                stream_metrics: (&m.stream_metrics).into(),
            },
            error: query.error.as_ref().map(|e| QueryErrorView { message: e.message.clone(), details: e.details.clone() }),
            result_table: query.result_table.map(|t| QueryResultTableView { id: t.id, rows: t.rows }),
            cache_key: query.cache_key.clone(),
            served_from_cache: query.served_from_cache,
            cache_deleted: query.cache_deleted,
            cached_at: query.cached_at,
            revision: query.revision,
        }
    }
}

/// The metrics of the finished queries of one outcome
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryOutcomeMetrics {
    pub total_queries: u64,
    pub total_batches_received: u64,
    pub total_rows_received: u64,
    pub accumulated_time_until_first_batch: i64,
    pub accumulated_query_duration: i64,
}

impl From<&ConnectionQueryMetrics> for QueryOutcomeMetrics {
    fn from(m: &ConnectionQueryMetrics) -> Self {
        QueryOutcomeMetrics {
            total_queries: m.total_queries,
            total_batches_received: m.total_batches_received,
            total_rows_received: m.total_rows_received,
            accumulated_time_until_first_batch: m.accumulated_time_until_first_batch,
            accumulated_query_duration: m.accumulated_query_duration,
        }
    }
}

/// The metrics of the finished queries of a history, internal queries don't count
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryHistoryMetrics {
    pub successful_queries: QueryOutcomeMetrics,
    pub canceled_queries: QueryOutcomeMetrics,
    pub failed_queries: QueryOutcomeMetrics,
}

/// The queries of a history: the active ones in the order they started and the finished ones in the order they
/// finished, each as `[id, revision]`
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueriesView {
    pub revision: u64,
    pub active: Vec<(u64, u64)>,
    pub finished: Vec<(u64, u64)>,
    /// Changes whenever a query starts or finishes
    pub snapshot: u64,
    pub metrics: QueryHistoryMetrics,
}

impl From<&QueryExecutionHistory> for QueriesView {
    fn from(history: &QueryExecutionHistory) -> Self {
        let list = |ids: &[u64]| ids.iter().map(|id| (*id, history.query(*id).map(|query| query.revision).unwrap_or(0))).collect();
        let metrics = history.metrics();
        QueriesView {
            revision: history.revision(),
            active: list(history.active_ids()),
            finished: list(history.finished_ids()),
            snapshot: history.snapshot_queries_active_finished(),
            metrics: QueryHistoryMetrics {
                successful_queries: (&metrics.successful_queries).into(),
                canceled_queries: (&metrics.canceled_queries).into(),
                failed_queries: (&metrics.failed_queries).into(),
            },
        }
    }
}
