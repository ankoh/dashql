//! The views of a query history: what crosses to the host and back, as JS objects (`serde-wasm-bindgen`) with
//! TypeScript declarations in the generated `.d.ts` (`tsify`). See docs/wip/runtime_projection.md.
//!
//! The views of the queries are the same for the history of a connection and a history of its own, e.g. the one of
//! the shell. Ids, revisions and times are numbers, a missing value is null. The counters of the stream metrics cross
//! as numbers that the host may count with fractions, Rust rounds them down.
//!
//! The structured progress of a query (`QueryProfileProgressView`) crosses as FlatBuffers of the core: the packed
//! `QueryProfile` of its plan and its execution state as packed `QueryProfileEvents`, each only when its key differs
//! from the one the host holds.

use dashql_buffers::profile as fb;
use dashql_core_runtime::query::progress::{EngineProgressPayload, QueryProfileProgress};
use dashql_core_runtime::query::{
    self as rt, ConnectionQueryMetrics, QueryExecutionHistory, QueryExecutionMetrics, QueryExecutionProgress, QueryExecutionState,
    QueryMetadata,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::views::{app_enum, FlatBufferBytes, JsonValue};

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

/// A progress update of a channel of the host: the plain fields and the raw progress payload of the engine, e.g.
/// `{ kind: 'hyper_query_status', status, receivedAt }`. The progress model of the query in the executor turns the
/// payload into the structured progress.
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
    /// The raw progress payload of the engine, a payload of an unknown kind is dropped
    #[serde(default)]
    #[tsify(optional, type = "unknown")]
    pub engine_progress: Option<serde_json::Value>,
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
            engine_progress: p.engine_progress.as_ref().and_then(|payload| EngineProgressPayload::from_json(payload).ok()),
            profile_progress: None,
        }
    }
}

/// The layout of the plans of query profiles, the fields of `ProfileLayoutConfigT` of the generated FlatBuffer code
#[derive(Clone, Copy, Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct ProfileLayoutView {
    pub level_height: f64,
    pub node_height: f64,
    pub node_margin_horizontal: f64,
    pub node_padding_left: f64,
    pub node_padding_right: f64,
    pub icon_width: f64,
    pub icon_margin_right: f64,
    pub max_label_chars: u32,
    pub width_per_label_char: f64,
    pub node_min_width: f64,
    pub node_margin_vertical: f64,
    /// A `ProfileLayoutOrientation`
    pub orientation: u8,
    pub symbol_width: f64,
}

impl From<ProfileLayoutView> for fb::ProfileLayoutConfig {
    fn from(l: ProfileLayoutView) -> Self {
        fb::ProfileLayoutConfig::new(
            l.level_height,
            l.node_height,
            l.node_margin_horizontal,
            l.node_padding_left,
            l.node_padding_right,
            l.icon_width,
            l.icon_margin_right,
            l.max_label_chars,
            l.width_per_label_char,
            l.node_min_width,
            l.node_margin_vertical,
            fb::ProfileLayoutOrientation(l.orientation),
            l.symbol_width,
        )
    }
}

/// The keys of the structured progress of a query that the host holds, their payloads don't cross again
#[derive(Clone, Copy, Debug, Default, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryProfileKeys {
    /// The revision of the progress, the execution state crosses when it differs
    pub revision: Option<f64>,
    /// The version of the structure, the structure crosses when it differs
    pub structure_version: Option<f64>,
}

/// The structured progress of a query: the plan with its stages and their execution state. A payload is null when the
/// host holds it already, its key names it.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryProfileProgressView {
    /// The revision of the progress, it changes with the structure or the execution state
    pub revision: u64,
    /// The version of the structure
    pub structure_version: u32,
    /// The packed `QueryProfile`, null while the host holds its version
    #[tsify(type = "FlatBuffer<buffers_profile.QueryProfile> | null")]
    pub structure: Option<FlatBufferBytes>,
    /// The execution state as packed `QueryProfileEvents`, one event per entity with state, null while the host holds
    /// the revision
    #[tsify(type = "FlatBuffer<buffers_profile.QueryProfileEvents> | null")]
    pub execution: Option<FlatBufferBytes>,
}

impl QueryProfileProgressView {
    /// The view of the structured progress, without the payloads that the host holds
    pub fn of(progress: &QueryProfileProgress, known: QueryProfileKeys) -> Self {
        let revision_known = known.revision == Some(progress.revision as f64);
        let structure_known = known.structure_version == Some(progress.structure_version as f64);
        QueryProfileProgressView {
            revision: progress.revision,
            structure_version: progress.structure_version,
            structure: (!structure_known).then(|| FlatBufferBytes(progress.structure.as_ref().clone())),
            execution: (!revision_known).then(|| FlatBufferBytes(progress.execution.pack_events(progress.structure_version))),
        }
    }
}

/// The latest progress update of a query: the plain fields and the structured progress
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryLatestProgressView {
    pub is_queued: Option<bool>,
    pub progress_percent: Option<f64>,
    pub result_rows: Option<u64>,
    pub rows_processed: Option<u64>,
    pub execution_time_ms: Option<i64>,
    pub metrics: QueryStreamMetrics,
    pub phase: Option<String>,
    pub profile: Option<QueryProfileProgressView>,
}

impl QueryLatestProgressView {
    fn of(progress: &QueryExecutionProgress, known: QueryProfileKeys) -> Self {
        QueryLatestProgressView {
            is_queued: progress.is_queued,
            progress_percent: progress.progress_percent,
            result_rows: progress.result_rows,
            rows_processed: progress.rows_processed,
            execution_time_ms: progress.execution_time_ms,
            metrics: (&progress.metrics).into(),
            phase: progress.phase.clone(),
            profile: progress.profile_progress.as_ref().map(|profile| QueryProfileProgressView::of(profile, known)),
        }
    }
}

/// What a query is and who issued it. A planned statement of a run of a workbook is opaque JSON
/// (`PlannedStatement` of the app).
#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryMetadataView {
    #[tsify(type = "QueryType")]
    pub query_type: QueryType,
    pub title: Option<String>,
    pub description: Option<String>,
    pub issuer: Option<String>,
    pub user_provided: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub workbook_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub result_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[tsify(optional, type = "unknown")]
    pub planned: Option<JsonValue>,
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
        metadata.planned = m.planned.map(|planned| planned.0).filter(|planned| !planned.is_null());
        metadata
    }
}

impl From<&QueryMetadata> for QueryMetadataView {
    fn from(m: &QueryMetadata) -> Self {
        QueryMetadataView {
            query_type: m.query_type.into(),
            title: m.title.clone(),
            description: m.description.clone(),
            issuer: m.issuer.clone(),
            user_provided: m.user_provided,
            workbook_id: m.workbook_id.clone(),
            result_owner: m.result_owner.clone(),
            planned: m.planned.clone().map(JsonValue),
        }
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

/// The result table of a query, the host keeps it under its handle
#[derive(Clone, Copy, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryResultTableView {
    pub id: u32,
    pub rows: u64,
}

/// A query, the slice `query` of the runtime: its text, what it is, its status and its latest progress. The field names
/// are the ones the app reads. The result table is a table of the handle table of the platform.
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryView {
    pub query_id: u64,
    /// The connection of the query, null for a query of a history without a connection
    pub connection_id: Option<String>,
    /// The trace of the log messages of the query
    pub trace_id: u64,
    pub query_text: String,
    pub query_metadata: QueryMetadataView,
    #[tsify(type = "QueryExecutionStatus")]
    pub status: QueryExecutionStatus,
    pub metrics: QueryMetricsView,
    pub error: Option<QueryErrorView>,
    pub result_table: Option<QueryResultTableView>,
    pub cache_key: Option<String>,
    pub served_from_cache: bool,
    pub cache_deleted: bool,
    pub cached_at: Option<i64>,
    pub latest_progress_update: Option<QueryLatestProgressView>,
    pub revision: u64,
    /// The handle of the record of the query at the host
    pub handle: Option<u32>,
}

impl QueryView {
    /// The view of a query, the payloads of its structured progress that the host holds don't cross
    pub fn of(query: &QueryExecutionState, connection_id: Option<&str>, known: QueryProfileKeys) -> Self {
        let m = &query.metrics;
        QueryView {
            query_id: query.query_id,
            connection_id: connection_id.map(str::to_string),
            trace_id: query.trace_id,
            query_text: query.query_text.clone(),
            query_metadata: (&query.query_metadata).into(),
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
            latest_progress_update: query.latest_progress_update.as_ref().map(|progress| QueryLatestProgressView::of(progress, known)),
            revision: query.revision,
            handle: query.handle,
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

/// The queries of a history without a connection, the slice `history`: the finished queries in the order they finished,
/// then the active ones in the order they started
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(missing_as_null)]
pub struct QueryHistoryView {
    pub queries: Vec<u64>,
}

impl From<&QueryExecutionHistory> for QueryHistoryView {
    fn from(history: &QueryExecutionHistory) -> Self {
        QueryHistoryView { queries: history.finished_ids().iter().chain(history.active_ids()).copied().collect() }
    }
}
