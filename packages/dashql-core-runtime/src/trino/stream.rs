//! A query on a Trino channel as a state machine: the statement, the pages of its results, the QueryInfos of its
//! profile, the end of the query.
//!
//! The query asks the host for requests and timers and reports the schema, the progress, the record batches and the
//! end of the query. The host sends a request through the channel (`TrinoChannel::http_request`, after
//! `begin_token_refresh`) and passes the outcome back with the id of the request, it starts a timer and passes its id
//! back once it fires. Every call takes the time it happens at.
//!
//! The query follows the next URIs until Trino stops sending one, the state of the query doesn't end the stream: Trino
//! reports states like PLANNING before the rows and FINISHED while the coordinator still buffers rows. The next page
//! is requested before the current one is translated, Trino fills the page meanwhile.
//!
//! While the profile of the query is shown, the query fetches the QueryInfo with the plans of the stages once the
//! stages exist. Trino reports the operator summaries of a stage (the rows of the plan) once its tasks are done, so
//! the QueryInfo is fetched again whenever the statement stats show more such stages, one request at a time, and once
//! more a second later while a stage with done tasks lacks its summaries. The requests don't hold up the query, a
//! failed one leaves the stages without plan or rows. Once the last page arrived, the query fetches the QueryInfo
//! until it is final, for at most three seconds, then it finishes. Progress after the end is dropped.

use std::collections::HashMap;
use std::rc::Rc;

use arrow_schema::SchemaRef;
use serde_json::Value;

use super::arrow::{rows_to_record_batch, trino_schema, NoTimeZones, TimeZoneOffsets};
use super::error::{TrinoError, TrinoErrorKind};
use crate::http::FetchOutcome;
use super::protocol::{
    read_query_info, read_result_page, read_statement_response, ResultPageOutcome, TrinoQueryResult, TrinoRequest,
    TrinoRetryPolicy,
};
use super::time::Millis;
use crate::query::progress::EngineProgressPayload;
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress};

/// Fetch the QueryInfo again after this long while a stage whose tasks are done has no operator summaries yet
pub const QUERY_INFO_RETRY_MS: u64 = 1000;
/// Wait this long for the final QueryInfo of a finished query
pub const QUERY_INFO_FINAL_TIMEOUT_MS: u64 = 3000;
/// Fetch the QueryInfo of a finished query this often until it is final
pub const QUERY_INFO_FINAL_RETRY_MS: u64 = 200;

/// The id of a request of a query
pub type RequestId = u32;
/// The id of a timer of a query
pub type TimerId = u32;

/// What a query asks of the host or reports, in order
#[derive(Debug, Clone, PartialEq)]
pub enum StreamOutput {
    /// Send a request through the channel and pass the outcome to `on_response` with the id
    Send { id: RequestId, request: TrinoRequest },
    /// Start a timer and call `on_timer` with the id once it fires
    StartTimer { id: TimerId, delay_ms: u64 },
    /// Clear a timer, it won't be needed
    ClearTimer { id: TimerId },
    /// The schema of the result is known, it comes once and before any batch
    Schema(SchemaRef),
    /// The progress of the query
    Progress(QueryExecutionProgress),
    /// A batch of the result
    Batch(arrow_array::RecordBatch),
    /// Something failed that doesn't fail the query, for the log
    Warning { message: String, error: TrinoError },
    /// The query finished, all batches were reported
    Finished,
    /// The query failed or was aborted
    Failed(TrinoError),
}

/// The options of a query
#[derive(Clone)]
pub struct TrinoQueryOptions {
    /// The retries of failed requests of result pages
    pub retry_policy: TrinoRetryPolicy,
    /// The offsets of named time zones for timestamps with time zone
    pub time_zones: Rc<dyn TimeZoneOffsets>,
}

impl Default for TrinoQueryOptions {
    fn default() -> Self {
        Self { retry_policy: TrinoRetryPolicy::default(), time_zones: Rc::new(NoTimeZones) }
    }
}

/// How far a query got
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The statement is posted, or the pages are fetched
    Running,
    /// The last page arrived, the query waits for the final QueryInfo
    Finishing,
    /// The query finished, failed or was aborted
    Done,
}

/// The request of the statement or of a page of results
#[derive(Debug, Clone)]
struct PageFetch {
    /// The statement or the next URI
    request: TrinoRequest,
    /// The attempt, from 1
    attempt: u32,
    /// When the first attempt was sent
    started_at: Millis,
}

/// What a request is for
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pending {
    /// The statement or a page
    Page,
    /// The QueryInfo with the plans of the stages
    Plan,
    /// A later QueryInfo for the operator summaries
    Stats,
}

/// What a timer is for
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Timer {
    /// Retry a page
    PageRetry,
    /// Fetch the QueryInfo again while summaries are missing
    InfoRetry,
    /// Fetch the QueryInfo of the finished query again
    FinalPoll,
    /// Stop waiting for the final QueryInfo
    FinalBound,
}

/// The QueryInfos of the profile of a query
#[derive(Debug, Clone, Default)]
struct ProfileFetch {
    /// Is the profile shown?
    detail: bool,
    /// Was the QueryInfo with the plans requested?
    requested: bool,
    /// The pending request of the plans
    plan: Option<RequestId>,
    /// The pending request of a QueryInfo for the operator summaries
    stats: Option<RequestId>,
    /// Does a request for the operator summaries wait for the plans?
    stats_after_plan: bool,
    /// Fetch the QueryInfo again once the pending request is done?
    stale: bool,
    /// The stages with done tasks that the requested QueryInfos cover
    done_stages: usize,
    /// The timer of the next QueryInfo while a stage with done tasks has no operator summaries
    retry_timer: Option<TimerId>,
}

impl ProfileFetch {
    /// Is a request for the operator summaries pending?
    fn stats_pending(&self) -> bool {
        self.stats.is_some() || self.stats_after_plan
    }
}

/// The wait for the final QueryInfo of a finished query
#[derive(Debug, Clone, Copy)]
struct FinalFetch {
    /// When the wait ends
    deadline: Millis,
    /// Does the wait start with a request that was pending when the query finished?
    awaiting_pending: bool,
}

/// A query on a Trino channel
pub struct TrinoQuery {
    /// The options
    options: TrinoQueryOptions,
    /// How far the query got
    phase: Phase,
    /// The id of the query at Trino, empty until the response to the statement
    query_id: String,
    /// The next URI of the latest response, none once the query is done
    next_uri: Option<String>,
    /// The statistics of the latest response
    latest_stats: Option<Value>,
    /// When the latest response arrived
    latest_received_at: Millis,
    /// The latest progress
    latest_progress: Option<QueryExecutionProgress>,
    /// The schema of the result
    schema: Option<SchemaRef>,
    /// The metrics of the requests and the result
    metrics: QueryExecutionMetrics,
    /// The request of the statement or a page, none between the pages
    page: Option<PageFetch>,
    /// The QueryInfos of the profile
    profile: ProfileFetch,
    /// The wait for the final QueryInfo
    final_fetch: Option<FinalFetch>,
    /// The pending requests
    pending: HashMap<RequestId, Pending>,
    /// The running timers
    timers: HashMap<TimerId, Timer>,
    /// The next id of a request
    next_request_id: RequestId,
    /// The next id of a timer
    next_timer_id: TimerId,
}

/// Are the tasks of a stage done? A stage waits for the query in PENDING and finishes with it.
fn is_stage_done(state: Option<&str>) -> bool {
    matches!(state, Some("PENDING" | "FINISHED"))
}

/// The stages of the statement stats whose tasks are done
pub fn count_done_stages(stage: &Value) -> usize {
    let own = usize::from(is_stage_done(stage.get("state").and_then(Value::as_str)));
    let children = stage.get("subStages").and_then(Value::as_array).map_or(0, |stages| stages.iter().map(count_done_stages).sum());
    own + children
}

/// Does a QueryInfo have a stage whose tasks are done but that reports no operator summaries yet? Right after a stage
/// turned PENDING, Trino may still wait for the final infos of its tasks.
pub fn lacks_operator_summaries(info: &Value) -> bool {
    let stages = info.pointer("/stages/stages").and_then(Value::as_array);
    stages.is_some_and(|stages| {
        stages.iter().any(|stage| {
            let summaries = stage.pointer("/stageStats/operatorSummaries").and_then(Value::as_array).map_or(0, Vec::len);
            is_stage_done(stage.get("state").and_then(Value::as_str)) && summaries == 0
        })
    })
}

/// Is a QueryInfo final? A finished query is once Trino collected the final infos of its tasks, a failed one may
/// never be.
pub fn is_final_query_info(info: &Value) -> bool {
    match info.get("state").and_then(Value::as_str) {
        Some("FAILED") => true,
        Some("FINISHED") => info.get("finalQueryInfo").and_then(Value::as_bool) == Some(true),
        _ => false,
    }
}

/// The execution progress of the statistics of a response that arrived at a time
pub fn derive_progress(stats: Option<&Value>, metrics: &QueryExecutionMetrics, received_at: Millis) -> QueryExecutionProgress {
    let number = |key: &str| stats.and_then(|stats| stats.get(key)).and_then(Value::as_f64);
    QueryExecutionProgress {
        is_queued: stats.and_then(|stats| stats.get("queued")).and_then(Value::as_bool),
        progress_percent: number("progressPercentage"),
        result_rows: None,
        rows_processed: number("processedRows").map(|rows| rows.max(0.0) as u64),
        execution_time_ms: number("elapsedTimeMillis").map(|ms| ms as i64),
        metrics: metrics.clone(),
        phase: stats.and_then(|stats| stats.get("state")).and_then(Value::as_str).map(str::to_string),
        engine_progress: stats.map(|stats| EngineProgressPayload::TrinoStatementStats { stats: stats.clone(), received_at }),
        profile_progress: None,
    }
}

impl TrinoQuery {
    /// Start a query: post the statement
    pub fn start(text: impl Into<String>, options: TrinoQueryOptions, now: Millis) -> (Self, Vec<StreamOutput>) {
        let mut query = Self {
            options,
            phase: Phase::Running,
            query_id: String::new(),
            next_uri: None,
            latest_stats: None,
            latest_received_at: now,
            latest_progress: None,
            schema: None,
            metrics: QueryExecutionMetrics::default(),
            page: None,
            profile: ProfileFetch::default(),
            final_fetch: None,
            pending: HashMap::new(),
            timers: HashMap::new(),
            next_request_id: 1,
            next_timer_id: 1,
        };
        let mut out = Vec::new();
        query.fetch_page(TrinoRequest::SubmitStatement { text: text.into() }, now, &mut out);
        (query, out)
    }

    /// The id of the query at Trino, empty until the response to the statement
    pub fn query_id(&self) -> &str {
        &self.query_id
    }
    /// The schema of the result, once it is known
    pub fn schema(&self) -> Option<&SchemaRef> {
        self.schema.as_ref()
    }
    /// The metrics of the requests and the result
    pub fn metrics(&self) -> &QueryExecutionMetrics {
        &self.metrics
    }
    /// The latest progress
    pub fn latest_progress(&self) -> Option<&QueryExecutionProgress> {
        self.latest_progress.as_ref()
    }
    /// Did the query finish, fail or was it aborted?
    pub fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// The request that cancels the query at Trino, none for a query without a next URI, which is done already. The
    /// host sends it outside of the query and reads the outcome with `read_cancel_response`, the query keeps running
    /// until the host aborts it.
    pub fn cancel_request(&self) -> Option<TrinoRequest> {
        self.next_uri.clone().map(|next_uri| TrinoRequest::CancelQuery { next_uri })
    }

    /// Show the profile of the query or stop showing it. The plans and the operator summaries are fetched only while
    /// it is shown.
    pub fn set_profile_detail(&mut self, wanted: bool, now: Millis) -> Vec<StreamOutput> {
        let mut out = Vec::new();
        self.profile.detail = wanted;
        if !wanted {
            self.clear_info_retry(&mut out);
        }
        self.request_profile(now, &mut out);
        out
    }

    /// Abort the query, e.g. the user stopped it. The host drops the pending requests and timers.
    pub fn abort(&mut self) -> Vec<StreamOutput> {
        let mut out = Vec::new();
        if self.phase != Phase::Done {
            self.end(&mut out);
            out.push(StreamOutput::Failed(TrinoError::new(TrinoErrorKind::Aborted, "The query was aborted")));
        }
        out
    }

    /// A request was answered or failed in the network. Outcomes of unknown requests are ignored, e.g. those of an
    /// ended query.
    pub fn on_response(&mut self, id: RequestId, outcome: &FetchOutcome, now: Millis) -> Vec<StreamOutput> {
        let mut out = Vec::new();
        match self.pending.remove(&id) {
            Some(Pending::Page) => self.on_page(Ok(outcome), now, &mut out),
            Some(Pending::Plan) => self.on_plan(query_info_of(Ok(outcome)), now, &mut out),
            Some(Pending::Stats) => self.on_stats(query_info_of(Ok(outcome)), now, &mut out),
            None => {}
        }
        out
    }

    /// A request couldn't be sent, e.g. its URI is invalid or the refresh of the access token failed. It is not
    /// retried.
    pub fn on_request_failed(&mut self, id: RequestId, error: TrinoError, now: Millis) -> Vec<StreamOutput> {
        let mut out = Vec::new();
        match self.pending.remove(&id) {
            Some(Pending::Page) => self.on_page(Err(error), now, &mut out),
            Some(Pending::Plan) => self.on_plan(Err(error), now, &mut out),
            Some(Pending::Stats) => self.on_stats(Err(error), now, &mut out),
            None => {}
        }
        out
    }

    /// A timer fired. Unknown timers are ignored, e.g. those that were cleared.
    pub fn on_timer(&mut self, id: TimerId, now: Millis) -> Vec<StreamOutput> {
        let mut out = Vec::new();
        match self.timers.remove(&id) {
            Some(Timer::PageRetry) => {
                if let Some(request) = self.page.as_ref().map(|page| page.request.clone()) {
                    self.send(request, Pending::Page, &mut out);
                }
            }
            Some(Timer::InfoRetry) => {
                self.profile.retry_timer = None;
                self.fetch_stats(now, &mut out);
            }
            Some(Timer::FinalPoll) => self.fetch_stats(now, &mut out),
            Some(Timer::FinalBound) => self.finish(&mut out),
            None => {}
        }
        out
    }

    /// Send a request
    fn send(&mut self, request: TrinoRequest, pending: Pending, out: &mut Vec<StreamOutput>) -> RequestId {
        let id = self.next_request_id;
        self.next_request_id = self.next_request_id.wrapping_add(1);
        self.pending.insert(id, pending);
        out.push(StreamOutput::Send { id, request });
        id
    }

    /// Start a timer
    fn start_timer(&mut self, timer: Timer, delay_ms: u64, out: &mut Vec<StreamOutput>) -> TimerId {
        let id = self.next_timer_id;
        self.next_timer_id = self.next_timer_id.wrapping_add(1);
        self.timers.insert(id, timer);
        out.push(StreamOutput::StartTimer { id, delay_ms });
        id
    }

    /// Clear a timer
    fn clear_timer(&mut self, id: TimerId, out: &mut Vec<StreamOutput>) {
        if self.timers.remove(&id).is_some() {
            out.push(StreamOutput::ClearTimer { id });
        }
    }

    /// Clear the timer of the next QueryInfo
    fn clear_info_retry(&mut self, out: &mut Vec<StreamOutput>) {
        if let Some(id) = self.profile.retry_timer.take() {
            self.clear_timer(id, out);
        }
    }

    /// Fetch the statement or a page
    fn fetch_page(&mut self, request: TrinoRequest, now: Millis, out: &mut Vec<StreamOutput>) {
        self.metrics.total_query_requests_started += 1;
        self.page = Some(PageFetch { request: request.clone(), attempt: 1, started_at: now });
        self.send(request, Pending::Page, out);
    }

    /// Publish the progress of the latest statistics
    fn publish_progress(&mut self, out: &mut Vec<StreamOutput>) {
        let progress = derive_progress(self.latest_stats.as_ref(), &self.metrics, self.latest_received_at);
        self.latest_progress = Some(progress.clone());
        out.push(StreamOutput::Progress(progress));
    }

    /// The statement or a page was answered
    fn on_page(&mut self, outcome: Result<&FetchOutcome, TrinoError>, now: Millis, out: &mut Vec<StreamOutput>) {
        let Some(mut page) = self.page.take() else {
            return;
        };
        let statement = matches!(page.request, TrinoRequest::SubmitStatement { .. });
        let status = match &outcome {
            Ok(FetchOutcome::Response(response)) => Some(response.status),
            _ => None,
        };
        let read = match outcome {
            Err(error) => ResultPageOutcome::Failed(error),
            Ok(FetchOutcome::Response(response)) if statement => match read_statement_response(response) {
                Ok(result) => ResultPageOutcome::Page(result),
                Err(error) => ResultPageOutcome::Failed(error),
            },
            Ok(FetchOutcome::NetworkError(message)) if statement => {
                ResultPageOutcome::Failed(TrinoError::new(TrinoErrorKind::Network, message.clone()))
            }
            Ok(outcome) => read_result_page(outcome, page.attempt, &self.options.retry_policy),
        };
        match read {
            ResultPageOutcome::Retry { delay_ms } => {
                let mut warning = TrinoError::new(TrinoErrorKind::Network, "A request of query results failed");
                warning.data.insert("attempt".into(), page.attempt.to_string());
                if let Some(status) = status {
                    warning.data.insert("status".into(), status.to_string());
                }
                out.push(StreamOutput::Warning { message: "Retrying a request of query results".into(), error: warning });
                page.attempt += 1;
                self.page = Some(page);
                self.start_timer(Timer::PageRetry, delay_ms, out);
            }
            ResultPageOutcome::Failed(error) => {
                self.metrics.total_query_requests_failed += 1;
                self.metrics.total_query_request_duration_ms += now - page.started_at;
                self.fail(error, out);
            }
            ResultPageOutcome::Page(result) => self.on_page_result(result, statement, page.started_at, now, out),
        }
    }

    /// The statement or a page arrived
    fn on_page_result(
        &mut self,
        result: TrinoQueryResult,
        statement: bool,
        started_at: Millis,
        now: Millis,
        out: &mut Vec<StreamOutput>,
    ) {
        if !result.id.is_empty() {
            self.query_id = result.id.clone();
        }
        self.latest_stats = result.stats;
        self.latest_received_at = now;
        self.next_uri = result.next_uri;

        // Did the query fail?
        if let Some(error) = result.error {
            self.metrics.total_query_requests_failed += 1;
            self.fail(error.to_error(), out);
            return;
        }
        self.metrics.total_query_requests_succeeded += 1;
        self.metrics.total_query_request_duration_ms += now - started_at;

        // Do we have a schema already?
        if self.schema.is_none() {
            if let Some(columns) = &result.columns {
                let schema = trino_schema(columns);
                self.schema = Some(schema.clone());
                out.push(StreamOutput::Schema(schema));
            }
        }

        if statement {
            // The response to the statement carries the first progress (QUEUED)
            if self.latest_stats.is_some() {
                self.publish_progress(out);
                self.request_profile(now, out);
            }
        }
        // Request the next page before translating this one
        if let Some(next_uri) = self.next_uri.clone() {
            self.fetch_page(TrinoRequest::FetchResults { next_uri }, now, out);
        }
        if let Some(rows) = result.data {
            let Some(schema) = self.schema.clone() else {
                self.fail(TrinoError::protocol("Result schema is missing"), out);
                return;
            };
            let batch = match rows_to_record_batch(&schema, &rows, self.options.time_zones.as_ref()) {
                Ok(batch) => batch,
                Err(error) => {
                    self.fail(error, out);
                    return;
                }
            };
            self.metrics.total_batches_received += 1;
            self.metrics.total_rows_received += batch.num_rows() as u64;
            self.publish_progress(out);
            self.request_profile(now, out);
            out.push(StreamOutput::Batch(batch));
        } else if !statement {
            self.publish_progress(out);
            self.request_profile(now, out);
        }
        if self.next_uri.is_none() {
            self.finish_query_info(now, out);
        }
    }

    /// Request the QueryInfo with the plans once the stages exist and the profile is shown, and again whenever more
    /// stages are done
    fn request_profile(&mut self, now: Millis, out: &mut Vec<StreamOutput>) {
        if !self.profile.detail || self.phase == Phase::Done || self.query_id.is_empty() {
            return;
        }
        let Some(root_stage) = self.latest_stats.as_ref().and_then(|stats| stats.get("rootStage")).filter(|stage| !stage.is_null())
        else {
            return;
        };
        let done_stages = count_done_stages(root_stage);
        if !self.profile.requested {
            self.profile.requested = true;
            self.profile.done_stages = done_stages;
            let request = TrinoRequest::FetchQueryInfo { query_id: self.query_id.clone() };
            self.profile.plan = Some(self.send(request, Pending::Plan, out));
        } else if done_stages > self.profile.done_stages {
            self.profile.done_stages = done_stages;
            self.fetch_stats(now, out);
        }
    }

    /// Fetch a QueryInfo for the operator summaries, after the plans. One request at a time, a request while one is
    /// pending fetches once more after it.
    fn fetch_stats(&mut self, _now: Millis, out: &mut Vec<StreamOutput>) {
        if self.profile.stats_pending() {
            self.profile.stale = true;
            return;
        }
        if self.phase == Phase::Done || self.query_id.is_empty() {
            return;
        }
        self.clear_info_retry(out);
        if self.profile.plan.is_some() {
            self.profile.stats_after_plan = true;
        } else {
            let request = TrinoRequest::FetchQueryInfo { query_id: self.query_id.clone() };
            self.profile.stats = Some(self.send(request, Pending::Stats, out));
        }
    }

    /// Fetch the QueryInfo again later while a stage with done tasks reports no operator summaries and the query runs
    fn retry_query_info_if_incomplete(&mut self, info: &Value, out: &mut Vec<StreamOutput>) {
        if self.phase != Phase::Running || !self.profile.detail || !lacks_operator_summaries(info) {
            return;
        }
        if self.profile.retry_timer.is_none() {
            self.profile.retry_timer = Some(self.start_timer(Timer::InfoRetry, QUERY_INFO_RETRY_MS, out));
        }
    }

    /// The QueryInfo with the plans arrived or failed
    fn on_plan(&mut self, info: Result<Value, TrinoError>, now: Millis, out: &mut Vec<StreamOutput>) {
        self.profile.plan = None;
        match info {
            Ok(info) => {
                let mut progress = derive_progress(self.latest_stats.as_ref(), &self.metrics, self.latest_received_at);
                progress.engine_progress = Some(EngineProgressPayload::TrinoQueryInfo { info: info.clone(), received_at: now });
                out.push(StreamOutput::Progress(progress));
                self.retry_query_info_if_incomplete(&info, out);
            }
            Err(error) => out.push(StreamOutput::Warning { message: "Failed to fetch the query plan".into(), error }),
        }
        // A request for the operator summaries waited for the plans
        if self.profile.stats_after_plan {
            self.profile.stats_after_plan = false;
            if self.phase != Phase::Done && !self.query_id.is_empty() {
                let request = TrinoRequest::FetchQueryInfo { query_id: self.query_id.clone() };
                self.profile.stats = Some(self.send(request, Pending::Stats, out));
            }
        }
    }

    /// A QueryInfo for the operator summaries arrived or failed
    fn on_stats(&mut self, info: Result<Value, TrinoError>, now: Millis, out: &mut Vec<StreamOutput>) {
        self.profile.stats = None;
        let info = info.ok();
        if let Some(info) = &info {
            let mut progress = derive_progress(self.latest_stats.as_ref(), &self.metrics, self.latest_received_at);
            progress.engine_progress = Some(EngineProgressPayload::TrinoQueryInfoStats { info: info.clone(), received_at: now });
            out.push(StreamOutput::Progress(progress));
        }
        if let Some(final_fetch) = &mut self.final_fetch {
            // The query finished: fetch until the QueryInfo is final
            if final_fetch.awaiting_pending {
                // A request that predates the end of the query, the wait starts with a new one
                final_fetch.awaiting_pending = false;
                self.profile.stale = false;
                self.fetch_stats(now, out);
                return;
            }
            let deadline = final_fetch.deadline;
            let done = match &info {
                None => true,
                Some(info) => is_final_query_info(info) || now + QUERY_INFO_FINAL_RETRY_MS as i64 >= deadline,
            };
            if done {
                self.finish(out);
            } else {
                self.start_timer(Timer::FinalPoll, QUERY_INFO_FINAL_RETRY_MS, out);
            }
            return;
        }
        if self.profile.stale {
            self.profile.stale = false;
            self.fetch_stats(now, out);
        } else if let Some(info) = &info {
            self.retry_query_info_if_incomplete(info, out);
        }
    }

    /// The last page arrived: wait for the final QueryInfo if the profile is shown, then finish
    fn finish_query_info(&mut self, now: Millis, out: &mut Vec<StreamOutput>) {
        self.clear_info_retry(out);
        if !(self.profile.detail && self.profile.requested) || self.query_id.is_empty() {
            self.finish(out);
            return;
        }
        self.phase = Phase::Finishing;
        let awaiting_pending = self.profile.stats_pending();
        self.final_fetch = Some(FinalFetch { deadline: now + QUERY_INFO_FINAL_TIMEOUT_MS as i64, awaiting_pending });
        self.start_timer(Timer::FinalBound, QUERY_INFO_FINAL_TIMEOUT_MS, out);
        if !awaiting_pending {
            self.fetch_stats(now, out);
        }
    }

    /// End the query: clear the timers and forget the pending requests
    fn end(&mut self, out: &mut Vec<StreamOutput>) {
        self.phase = Phase::Done;
        self.page = None;
        self.final_fetch = None;
        self.pending.clear();
        self.profile.plan = None;
        self.profile.stats = None;
        self.profile.stats_after_plan = false;
        self.profile.retry_timer = None;
        let mut timers: Vec<TimerId> = self.timers.drain().map(|(id, _)| id).collect();
        timers.sort_unstable();
        out.extend(timers.into_iter().map(|id| StreamOutput::ClearTimer { id }));
    }

    /// The query finished
    fn finish(&mut self, out: &mut Vec<StreamOutput>) {
        self.end(out);
        out.push(StreamOutput::Finished);
    }

    /// The query failed
    fn fail(&mut self, error: TrinoError, out: &mut Vec<StreamOutput>) {
        self.end(out);
        out.push(StreamOutput::Failed(error));
    }
}

/// The QueryInfo of the outcome of its request
fn query_info_of(outcome: Result<&FetchOutcome, TrinoError>) -> Result<Value, TrinoError> {
    match outcome? {
        FetchOutcome::Response(response) => read_query_info(response),
        FetchOutcome::NetworkError(message) => Err(TrinoError::new(TrinoErrorKind::Network, message.clone())),
    }
}
