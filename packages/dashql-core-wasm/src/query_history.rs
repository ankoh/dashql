//! The wasm-bindgen API of a query history of its own (`dashql_core_runtime::query`), e.g. the one of the shell, and
//! the query actions that it shares with the history of a `Connection`.
//!
//! An action is a method call with typed arguments, the metadata, the progress and the metrics are views
//! (`query_history/view.rs`). It returns a `ConnectionOutcome` with the effects for the host: the result tables that
//! nothing shows anymore. The history is read as views: the list of the queries with their revisions and each query.

use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionHistory, QueryExecutionOutcome, QueryExecutionState, QueryResultTable};
use tsify::Ts;
use wasm_bindgen::prelude::*;

use super::connection::view::ConnectionOutcome;
use super::js_error;
use super::views::{from_js, to_js};

pub(crate) mod view;

use view::{QueryMetadataView, QueryProgressView, QueryStreamMetrics};

/// The outcome of an action on a history
pub(crate) fn query_outcome(outcome: QueryExecutionOutcome) -> ConnectionOutcome {
    ConnectionOutcome { changed: outcome.changed, effects: outcome.effects.iter().map(Into::into).collect() }
}

/// The actions on queries, of a `Connection` and of a `QueryHistory`. The type has `apply_query` for an action and
/// `read_queries` for its history. Ids and times are numbers of the host, the views are converted here.
macro_rules! query_actions {
    ($type:ident) => {
        #[wasm_bindgen]
        impl $type {
            /// Start tracking a requested query
            #[wasm_bindgen(js_name = executeQuery)]
            pub fn execute_query(
                &mut self,
                query_id: f64,
                trace_id: f64,
                text: String,
                metadata: Ts<$crate::query_history::view::QueryMetadataView>,
                requested_at: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query($crate::query_history::execute_query(query_id, trace_id, text, metadata, requested_at)?)
            }

            #[wasm_bindgen(js_name = querySending)]
            pub fn query_sending(&mut self, query_id: f64, now: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QuerySending { query_id: query_id as u64, now: now as i64 })
            }

            #[wasm_bindgen(js_name = queryRunning)]
            pub fn query_running(&mut self, query_id: f64, now: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QueryRunning { query_id: query_id as u64, now: now as i64 })
            }

            /// The backend reported progress, the plain fields of the progress cross
            #[wasm_bindgen(js_name = queryProgressUpdated)]
            pub fn query_progress_updated(
                &mut self,
                query_id: f64,
                progress: Ts<$crate::query_history::view::QueryProgressView>,
                now: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query($crate::query_history::query_progress_updated(query_id, progress, now)?)
            }

            #[wasm_bindgen(js_name = queryReceivedBatch)]
            pub fn query_received_batch(
                &mut self,
                query_id: f64,
                metrics: Ts<$crate::query_history::view::QueryStreamMetrics>,
                now: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                let metrics = $crate::views::from_js(&metrics)?.into();
                self.apply_query(QueryExecutionAction::QueryReceivedBatch { query_id: query_id as u64, metrics, now: now as i64 })
            }

            /// All batches arrived, the host keeps the table under its id
            #[wasm_bindgen(js_name = queryReceivedAllBatches)]
            pub fn query_received_all_batches(
                &mut self,
                query_id: f64,
                table_id: f64,
                rows: f64,
                metrics: Ts<$crate::query_history::view::QueryStreamMetrics>,
                now: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query($crate::query_history::query_received_all_batches(query_id, table_id, rows, metrics, now)?)
            }

            #[wasm_bindgen(js_name = queryProcessingResults)]
            pub fn query_processing_results(&mut self, query_id: f64, now: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QueryProcessingResults { query_id: query_id as u64, now: now as i64 })
            }

            #[wasm_bindgen(js_name = queryProcessedResults)]
            pub fn query_processed_results(&mut self, query_id: f64, now: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QueryProcessedResults { query_id: query_id as u64, now: now as i64 })
            }

            #[wasm_bindgen(js_name = querySucceeded)]
            pub fn query_succeeded(&mut self, query_id: f64, now: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QuerySucceeded { query_id: query_id as u64, now: now as i64 })
            }

            /// The query failed, with the stream metrics so far if the connector has them
            #[wasm_bindgen(js_name = queryFailed)]
            pub fn query_failed(
                &mut self,
                query_id: f64,
                message: String,
                details: Option<String>,
                metrics: Option<Ts<$crate::query_history::view::QueryStreamMetrics>>,
                now: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                let (query_id, error, metrics, now) = $crate::query_history::query_ended(query_id, message, details, metrics, now)?;
                self.apply_query(QueryExecutionAction::QueryFailed { query_id, error, metrics, now })
            }

            /// The query was cancelled, with the stream metrics so far if the connector has them
            #[wasm_bindgen(js_name = queryCancelled)]
            pub fn query_cancelled(
                &mut self,
                query_id: f64,
                message: String,
                details: Option<String>,
                metrics: Option<Ts<$crate::query_history::view::QueryStreamMetrics>>,
                now: f64,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                let (query_id, error, metrics, now) = $crate::query_history::query_ended(query_id, message, details, metrics, now)?;
                self.apply_query(QueryExecutionAction::QueryCancelled { query_id, error, metrics, now })
            }

            #[wasm_bindgen(js_name = queryCacheRecorded)]
            pub fn query_cache_recorded(
                &mut self,
                query_id: f64,
                cache_key: String,
                served_from_cache: bool,
                cached_at: Option<f64>,
            ) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                let cached_at = cached_at.map(|at| at as i64);
                self.apply_query(QueryExecutionAction::QueryCacheRecorded { query_id: query_id as u64, cache_key, served_from_cache, cached_at })
            }

            #[wasm_bindgen(js_name = queryCacheDeleted)]
            pub fn query_cache_deleted(&mut self, query_id: f64) -> Result<Ts<$crate::connection::view::ConnectionOutcome>, JsError> {
                self.apply_query(QueryExecutionAction::QueryCacheDeleted { query_id: query_id as u64 })
            }

            /// The queries: the active and the finished ones in order with their revisions, the counter of started
            /// and finished queries and the metrics of the finished queries
            pub fn queries(&self) -> Result<Ts<$crate::query_history::view::QueriesView>, JsError> {
                self.read_queries(|history| $crate::views::to_js(&$crate::query_history::view::QueriesView::from(history)))
            }

            /// The plain fields of a query, none for an unknown query
            pub fn query(&self, query_id: f64) -> Result<Option<Ts<$crate::query_history::view::QueryView>>, JsError> {
                self.read_queries(|history| {
                    history.query(query_id as u64).map(|query| $crate::views::to_js(&$crate::query_history::view::QueryView::from(query))).transpose()
                })
            }
        }
    };
}
pub(crate) use query_actions;

// The actions that take more than the id of a query and the time

pub(crate) fn execute_query(query_id: f64, trace_id: f64, text: String, metadata: Ts<QueryMetadataView>, requested_at: f64) -> Result<QueryExecutionAction, JsError> {
    let metadata = from_js(&metadata)?.into();
    let state = QueryExecutionState::new(query_id as u64, trace_id as u64, text, metadata, requested_at as i64);
    Ok(QueryExecutionAction::ExecuteQuery { state: Box::new(state) })
}

pub(crate) fn query_progress_updated(query_id: f64, progress: Ts<QueryProgressView>, now: f64) -> Result<QueryExecutionAction, JsError> {
    let progress = Box::new(from_js(&progress)?.into());
    Ok(QueryExecutionAction::QueryProgressUpdated { query_id: query_id as u64, progress, now: now as i64 })
}

pub(crate) fn query_received_all_batches(
    query_id: f64,
    table_id: f64,
    rows: f64,
    metrics: Ts<QueryStreamMetrics>,
    now: f64,
) -> Result<QueryExecutionAction, JsError> {
    let metrics = from_js(&metrics)?.into();
    let table = QueryResultTable { id: table_id as u64, rows: rows.max(0.0) as u64 };
    Ok(QueryExecutionAction::QueryReceivedAllBatches { query_id: query_id as u64, table, metrics, now: now as i64 })
}

/// The fields of a failed or cancelled query
#[allow(clippy::type_complexity)]
pub(crate) fn query_ended(
    query_id: f64,
    message: String,
    details: Option<String>,
    metrics: Option<Ts<QueryStreamMetrics>>,
    now: f64,
) -> Result<(u64, QueryError, Option<dashql_core_runtime::query::QueryExecutionMetrics>, i64), JsError> {
    let metrics = metrics.as_ref().map(from_js).transpose()?.map(Into::into);
    Ok((query_id as u64, QueryError { message, details }, metrics, now as i64))
}

/// A history of queries without a connection, e.g. of the shell
#[wasm_bindgen]
pub struct QueryHistory {
    history: QueryExecutionHistory,
}

impl QueryHistory {
    fn apply_query(&mut self, action: QueryExecutionAction) -> Result<Ts<ConnectionOutcome>, JsError> {
        let outcome = self.history.apply(action).map_err(js_error)?;
        to_js(&query_outcome(outcome))
    }

    fn read_queries<R>(&self, read: impl FnOnce(&QueryExecutionHistory) -> R) -> R {
        read(&self.history)
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

    /// The revision of the history, it changes with every change of a query
    pub fn revision(&self) -> f64 {
        self.history.revision() as f64
    }
}

query_actions!(QueryHistory);
