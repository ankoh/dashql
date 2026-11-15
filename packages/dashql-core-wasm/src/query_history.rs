//! The wasm-bindgen API of a query history of its own (`dashql_core_runtime::query`), e.g. the one of the shell, and
//! the query actions that it shares with the history of a `Connection`.
//!
//! An action is a method call with typed arguments, metadata, progress and metrics cross as JSON. It returns a
//! `ConnectionOutcome` with the effects for the host as JSON: the result tables that nothing shows anymore. The history
//! is read as JSON snapshots: the list of the queries with their revisions and each query.

use dashql_core::error::Error;
use dashql_core_runtime::query::{
    ConnectionQueryMetrics, QueryError, QueryExecutionAction, QueryExecutionEffect, QueryExecutionHistory,
    QueryExecutionMetrics, QueryExecutionOutcome, QueryExecutionProgress, QueryExecutionState, QueryMetadata,
    QueryResultTable, QueryType,
};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use super::connection::ConnectionOutcome;
use super::js_error;

fn invalid(message: impl Into<String>) -> JsError {
    js_error(Error::invalid_argument(message))
}

fn parse(text: &str) -> Result<Value, JsError> {
    serde_json::from_str(text).map_err(|e| invalid(format!("invalid JSON: {e}")))
}

fn stream_metrics(value: &Value) -> QueryExecutionMetrics {
    let count = |key: &str| value.get(key).and_then(Value::as_f64).map(|v| v.max(0.0) as u64).unwrap_or(0);
    QueryExecutionMetrics {
        total_data_bytes_received: count("totalDataBytesReceived"),
        total_batches_received: count("totalBatchesReceived"),
        total_rows_received: count("totalRowsReceived"),
        total_query_requests_started: count("totalQueryRequestsStarted"),
        total_query_requests_succeeded: count("totalQueryRequestsSucceeded"),
        total_query_requests_failed: count("totalQueryRequestsFailed"),
        total_query_request_duration_ms: value.get("totalQueryRequestDurationMs").and_then(Value::as_f64).unwrap_or(0.0) as i64,
        duration_until_first_batch_ms: value.get("durationUntilFirstBatchMs").and_then(Value::as_f64).map(|v| v as i64),
    }
}

fn stream_metrics_json(metrics: &QueryExecutionMetrics) -> Value {
    json!({
        "totalDataBytesReceived": metrics.total_data_bytes_received,
        "totalBatchesReceived": metrics.total_batches_received,
        "totalRowsReceived": metrics.total_rows_received,
        "totalQueryRequestsStarted": metrics.total_query_requests_started,
        "totalQueryRequestsSucceeded": metrics.total_query_requests_succeeded,
        "totalQueryRequestsFailed": metrics.total_query_requests_failed,
        "totalQueryRequestDurationMs": metrics.total_query_request_duration_ms,
        "durationUntilFirstBatchMs": metrics.duration_until_first_batch_ms,
    })
}

/// The optional stream metrics of a failed or cancelled query
fn optional_stream_metrics(metrics: Option<String>) -> Result<Option<QueryExecutionMetrics>, JsError> {
    Ok(metrics.as_deref().map(parse).transpose()?.map(|value| stream_metrics(&value)))
}

fn query_type(query_type: u8) -> Result<QueryType, JsError> {
    Ok(match query_type {
        0 => QueryType::UserProvided,
        1 => QueryType::CatalogQueryInformationSchema,
        2 => QueryType::CatalogQueryPgAttribute,
        3 => QueryType::CatalogQueryPgProc,
        4 => QueryType::CatalogQueryHyperCloud,
        5 => QueryType::HealthCheck,
        6 => QueryType::InternalSqlframe,
        7 => QueryType::CloudStore,
        _ => return Err(invalid(format!("unknown query type {query_type}"))),
    })
}

/// The metadata of a query from its JSON, the fields of `QueryMetadata` of the runtime. A planned statement stays with
/// the host.
fn query_metadata(text: &str) -> Result<QueryMetadata, JsError> {
    let value = parse(text)?;
    let string = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
    let kind = query_type(value.get("queryType").and_then(Value::as_u64).unwrap_or(0) as u8)?;
    let mut metadata = QueryMetadata::new(kind);
    metadata.title = string("title");
    metadata.description = string("description");
    metadata.issuer = string("issuer");
    metadata.user_provided = value.get("userProvided").and_then(Value::as_bool).unwrap_or(metadata.user_provided);
    metadata.workbook_id = string("workbookId");
    metadata.result_owner = string("resultOwner");
    Ok(metadata)
}

// The actions that take more than the id of a query and the time

/// Start tracking a requested query, the metadata is JSON
pub(crate) fn execute_query(query_id: f64, trace_id: f64, text: String, metadata: &str, requested_at: f64) -> Result<QueryExecutionAction, JsError> {
    let metadata = query_metadata(metadata)?;
    let state = QueryExecutionState::new(query_id as u64, trace_id as u64, text, metadata, requested_at as i64);
    Ok(QueryExecutionAction::ExecuteQuery { state: Box::new(state) })
}

/// The backend reported progress, the plain fields of the progress as JSON. The structured progress stays with the
/// host.
pub(crate) fn query_progress_updated(query_id: f64, progress: &str, now: f64) -> Result<QueryExecutionAction, JsError> {
    let value = parse(progress)?;
    let number = |key: &str| value.get(key).and_then(Value::as_f64);
    let progress = QueryExecutionProgress {
        is_queued: value.get("isQueued").and_then(Value::as_bool),
        progress_percent: number("progressPercent"),
        result_rows: number("resultRows").map(|v| v.max(0.0) as u64),
        rows_processed: number("rowsProcessed").map(|v| v.max(0.0) as u64),
        execution_time_ms: number("executionTimeMs").map(|v| v as i64),
        metrics: value.get("metrics").map(stream_metrics).unwrap_or_default(),
        phase: value.get("phase").and_then(Value::as_str).map(str::to_string),
        engine_progress: None,
        profile_progress: None,
    };
    Ok(QueryExecutionAction::QueryProgressUpdated { query_id: query_id as u64, progress: Box::new(progress), now: now as i64 })
}

pub(crate) fn query_received_batch(query_id: f64, metrics: &str, now: f64) -> Result<QueryExecutionAction, JsError> {
    let metrics = stream_metrics(&parse(metrics)?);
    Ok(QueryExecutionAction::QueryReceivedBatch { query_id: query_id as u64, metrics, now: now as i64 })
}

/// All batches arrived, the host keeps the table under its id
pub(crate) fn query_received_all_batches(query_id: f64, table_id: f64, rows: f64, metrics: &str, now: f64) -> Result<QueryExecutionAction, JsError> {
    let metrics = stream_metrics(&parse(metrics)?);
    let table = QueryResultTable { id: table_id as u64, rows: rows.max(0.0) as u64 };
    Ok(QueryExecutionAction::QueryReceivedAllBatches { query_id: query_id as u64, table, metrics, now: now as i64 })
}

pub(crate) fn query_failed(query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<QueryExecutionAction, JsError> {
    let metrics = optional_stream_metrics(metrics)?;
    let error = QueryError { message, details };
    Ok(QueryExecutionAction::QueryFailed { query_id: query_id as u64, error, metrics, now: now as i64 })
}

pub(crate) fn query_cancelled(query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<QueryExecutionAction, JsError> {
    let metrics = optional_stream_metrics(metrics)?;
    let error = QueryError { message, details };
    Ok(QueryExecutionAction::QueryCancelled { query_id: query_id as u64, error, metrics, now: now as i64 })
}

pub(crate) fn query_cache_recorded(query_id: f64, cache_key: String, served_from_cache: bool, cached_at: Option<f64>) -> QueryExecutionAction {
    let cached_at = cached_at.map(|at| at as i64);
    QueryExecutionAction::QueryCacheRecorded { query_id: query_id as u64, cache_key, served_from_cache, cached_at }
}

// Reading a history

pub(crate) fn query_effect_json(effect: &QueryExecutionEffect) -> Value {
    match effect {
        QueryExecutionEffect::ReleaseResultTable { query_id, table } => {
            json!({ "type": "releaseResultTable", "queryId": query_id, "tableId": table.id })
        }
    }
}

/// The outcome of an action on a history with its effects as JSON
pub(crate) fn query_outcome(outcome: QueryExecutionOutcome) -> ConnectionOutcome {
    let effects = Value::Array(outcome.effects.iter().map(query_effect_json).collect()).to_string();
    ConnectionOutcome::new(outcome.changed, effects)
}

/// The plain fields of a query as JSON
pub(crate) fn query_json(query: &QueryExecutionState) -> Value {
    let metrics = &query.metrics;
    json!({
        "queryId": query.query_id,
        "status": query.status as u8,
        "metrics": {
            "queryRequestedAt": metrics.query_requested_at,
            "querySendingStartedAt": metrics.query_sending_started_at,
            "queryQueuedStartedAt": metrics.query_queued_started_at,
            "queryRunningStartedAt": metrics.query_running_started_at,
            "receivedFirstBatchAt": metrics.received_first_batch_at,
            "receivedLastBatchAt": metrics.received_last_batch_at,
            "receivedAllBatchesAt": metrics.received_all_batches_at,
            "processingResultsStartedAt": metrics.processing_results_started_at,
            "processedResultsAt": metrics.processed_results_at,
            "querySucceededAt": metrics.query_succeeded_at,
            "queryFailedAt": metrics.query_failed_at,
            "queryCancelledAt": metrics.query_cancelled_at,
            "lastUpdatedAt": metrics.last_updated_at,
            "progressUpdatesReceived": metrics.progress_updates_received,
            "queryDurationMs": metrics.query_duration_ms,
            "textLength": metrics.text_length,
            "streamMetrics": stream_metrics_json(&metrics.stream_metrics),
        },
        "error": query.error.as_ref().map(|error| json!({ "message": error.message, "details": error.details })),
        "resultTable": query.result_table.map(|table| json!({ "id": table.id, "rows": table.rows })),
        "cacheKey": query.cache_key,
        "servedFromCache": query.served_from_cache,
        "cacheDeleted": query.cache_deleted,
        "cachedAt": query.cached_at,
        "revision": query.revision,
    })
}

/// The queries as JSON: the active and the finished ones in order with their revisions, the counter of started and
/// finished queries and the metrics of the finished queries
pub(crate) fn queries_json(history: &QueryExecutionHistory) -> String {
    let list = |ids: &[u64]| -> Vec<Value> {
        ids.iter().map(|id| json!([id, history.query(*id).map(|query| query.revision).unwrap_or(0)])).collect()
    };
    let metrics = history.metrics();
    let outcome = |m: &ConnectionQueryMetrics| {
        json!({
            "totalQueries": m.total_queries,
            "totalBatchesReceived": m.total_batches_received,
            "totalRowsReceived": m.total_rows_received,
            "accumulatedTimeUntilFirstBatch": m.accumulated_time_until_first_batch,
            "accumulatedQueryDuration": m.accumulated_query_duration,
        })
    };
    json!({
        "revision": history.revision(),
        "active": list(history.active_ids()),
        "finished": list(history.finished_ids()),
        "snapshot": history.snapshot_queries_active_finished(),
        "metrics": {
            "successfulQueries": outcome(&metrics.successful_queries),
            "canceledQueries": outcome(&metrics.canceled_queries),
            "failedQueries": outcome(&metrics.failed_queries),
        },
    })
    .to_string()
}

/// A history of queries without a connection, e.g. of the shell
#[wasm_bindgen]
pub struct QueryHistory {
    history: QueryExecutionHistory,
}

impl QueryHistory {
    fn apply(&mut self, action: QueryExecutionAction) -> Result<ConnectionOutcome, JsError> {
        self.history.apply(action).map(query_outcome).map_err(js_error)
    }
}

#[wasm_bindgen]
impl QueryHistory {
    /// An empty history that keeps at most `limit` queries, all without
    #[wasm_bindgen(constructor)]
    pub fn new(limit: Option<u32>) -> QueryHistory {
        let history = match limit {
            Some(limit) => QueryExecutionHistory::with_limit(limit as usize),
            None => QueryExecutionHistory::new(),
        };
        QueryHistory { history }
    }

    /// Start tracking a requested query, the metadata is JSON
    #[wasm_bindgen(js_name = executeQuery)]
    pub fn execute_query(&mut self, query_id: f64, trace_id: f64, text: String, metadata: &str, requested_at: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(execute_query(query_id, trace_id, text, metadata, requested_at)?)
    }

    #[wasm_bindgen(js_name = querySending)]
    pub fn query_sending(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QuerySending { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryRunning)]
    pub fn query_running(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QueryRunning { query_id: query_id as u64, now: now as i64 })
    }

    /// The backend reported progress, the plain fields of the progress as JSON
    #[wasm_bindgen(js_name = queryProgressUpdated)]
    pub fn query_progress_updated(&mut self, query_id: f64, progress: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_progress_updated(query_id, progress, now)?)
    }

    #[wasm_bindgen(js_name = queryReceivedBatch)]
    pub fn query_received_batch(&mut self, query_id: f64, metrics: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_received_batch(query_id, metrics, now)?)
    }

    /// All batches arrived, the host keeps the table under its id
    #[wasm_bindgen(js_name = queryReceivedAllBatches)]
    pub fn query_received_all_batches(&mut self, query_id: f64, table_id: f64, rows: f64, metrics: &str, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_received_all_batches(query_id, table_id, rows, metrics, now)?)
    }

    #[wasm_bindgen(js_name = queryProcessingResults)]
    pub fn query_processing_results(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QueryProcessingResults { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryProcessedResults)]
    pub fn query_processed_results(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QueryProcessedResults { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = querySucceeded)]
    pub fn query_succeeded(&mut self, query_id: f64, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QuerySucceeded { query_id: query_id as u64, now: now as i64 })
    }

    #[wasm_bindgen(js_name = queryFailed)]
    pub fn query_failed(&mut self, query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_failed(query_id, message, details, metrics, now)?)
    }

    #[wasm_bindgen(js_name = queryCancelled)]
    pub fn query_cancelled(&mut self, query_id: f64, message: String, details: Option<String>, metrics: Option<String>, now: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_cancelled(query_id, message, details, metrics, now)?)
    }

    #[wasm_bindgen(js_name = queryCacheRecorded)]
    pub fn query_cache_recorded(&mut self, query_id: f64, cache_key: String, served_from_cache: bool, cached_at: Option<f64>) -> Result<ConnectionOutcome, JsError> {
        self.apply(query_cache_recorded(query_id, cache_key, served_from_cache, cached_at))
    }

    #[wasm_bindgen(js_name = queryCacheDeleted)]
    pub fn query_cache_deleted(&mut self, query_id: f64) -> Result<ConnectionOutcome, JsError> {
        self.apply(QueryExecutionAction::QueryCacheDeleted { query_id: query_id as u64 })
    }

    /// The revision of the history, it changes with every change of a query
    pub fn revision(&self) -> f64 {
        self.history.revision() as f64
    }

    /// The queries as JSON, see `Connection.queries`
    pub fn queries(&self) -> String {
        queries_json(&self.history)
    }

    /// The plain fields of a query as JSON, none for an unknown query
    pub fn query(&self, query_id: f64) -> Option<String> {
        self.history.query(query_id as u64).map(|query| query_json(query).to_string())
    }
}
