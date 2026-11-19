//! The connectors of the executor: how a query of a target streams its result.
//!
//! Trino and the HTTP API of Hyper are state machines of the crate, the executor sends their requests with
//! `HttpHost::fetch`, runs their timers with `Host::sleep` and feeds the outcomes back. A client function call sends
//! the requests of its run until the result is complete. A channel of the host streams the metrics of its batches.
//! Every connector reports `Running` once the result streams, its progress and the parts of its result, and stops at
//! the backend when the query is cancelled. No connector keeps a part of the result: a page of Trino or of a client
//! function is written as the next part of an Arrow IPC stream and handed to the host, a chunk of Hyper is handed on
//! as it is.

use std::collections::VecDeque;
use std::rc::Rc;

use arrow_array::RecordBatch;
use arrow_schema::SchemaRef;

use super::ipc::IpcStreamWriter;
use super::wait::{next, TaskSet, Wake};
use super::{
    ChannelMessage, ClientFunctionTarget, ExecutorHost, ExecutorRun, FailureKind, QueryEvent, QueryFailure,
    QueryTarget, LOG_TARGET,
};
use crate::clfn::{
    start_connection_client_function, CallStep, ClientFunctionResult, ConnectionCallStart, ConnectionCredentials,
};
use crate::connections::DetailedError;
use crate::host::signal::Receiver;
use crate::host::{timeout, HostError, LogLevel};
use crate::http::{Body, CancellationToken, FetchOutcome, Headers, HttpHost, HttpResponse};
use crate::hyper::{HyperHttpChannel, ResultEvent};
use crate::query::progress::QueryProgressModel;
use crate::query::{QueryExecutionMetrics, QueryExecutionProgress};
use dashql_buffers::profile::ProfileLayoutConfig;
use crate::trino::{
    refresh_outcome, SharedTrinoChannel, StreamOutput, TokenCheck, TrinoError, TrinoQuery,
    TrinoQueryOptions,
};

/// A failure to write the Arrow IPC stream of a result
fn write_failure(message: String) -> QueryFailure {
    QueryFailure::new(FailureKind::Error, message)
}

/// The end of a result stream, the host holds its parts
pub struct StreamEnd {
    /// The metrics of the stream
    pub metrics: QueryExecutionMetrics,
}

/// What a connector reports to while it streams a result
pub struct StreamContext<H: ExecutorHost> {
    host: Rc<H>,
    run: Rc<H::Run>,
    /// The token of the run
    token: CancellationToken,
    publish: bool,
    log_details: Vec<(String, String)>,
    /// Did the result start to stream?
    started: bool,
    /// The schema of a result that the module converts to Arrow
    schema: Option<SchemaRef>,
    /// The Arrow IPC stream of a converted result, once its first part was written
    writer: Option<IpcStreamWriter>,
    metrics: QueryExecutionMetrics,
    /// The layout of the plan of the progress, none for the default one
    progress_layout: Option<ProfileLayoutConfig>,
    /// The progress model of the query, created with the first payload of the engine
    progress_model: Option<QueryProgressModel>,
}

impl<H: ExecutorHost> StreamContext<H> {
    pub(crate) fn new(
        host: Rc<H>,
        run: Rc<H::Run>,
        publish: bool,
        log_details: Vec<(String, String)>,
        progress_layout: Option<ProfileLayoutConfig>,
    ) -> Self {
        let token = run.token().clone();
        Self {
            host,
            run,
            token,
            publish,
            log_details,
            started: false,
            schema: None,
            writer: None,
            metrics: QueryExecutionMetrics::default(),
            progress_layout,
            progress_model: None,
        }
    }

    /// The metrics of the stream, none before it started
    pub(crate) fn metrics_if_started(&self) -> Option<QueryExecutionMetrics> {
        self.started.then(|| self.metrics.clone())
    }

    fn report(&self, event: QueryEvent) {
        self.host.report(&self.run, event);
    }

    /// Hand the next part of the result stream to the host
    fn push(&self, part: Body) -> Result<(), QueryFailure> {
        self.host.push_result(&self.run, part).map_err(|error| QueryFailure::from_host(&error))
    }

    fn log(&self, level: LogLevel, message: &str, details: Vec<(String, String)>, target: &str) {
        let mut all = self.log_details.clone();
        all.push(("query".to_string(), self.run.query_id().to_string()));
        all.extend(details);
        self.report(QueryEvent::Log { level, message: message.to_string(), details: all, target: target.to_string() });
    }

    /// The result streams
    fn running(&mut self) {
        if self.started {
            return;
        }
        self.started = true;
        self.log(LogLevel::Debug, "Received query results", Vec::new(), LOG_TARGET);
        self.report(QueryEvent::Running);
    }

    /// The backend reported progress. Its engine payload goes into the progress model of the query, the update
    /// carries the structured progress instead. A malformed payload is logged, the update keeps the structured
    /// progress of the previous one then.
    fn progress(&mut self, mut progress: QueryExecutionProgress) {
        if let Some(payload) = progress.engine_progress.take() {
            let layout = self.progress_layout.as_ref();
            let model = self.progress_model.get_or_insert_with(|| QueryProgressModel::new(payload.engine(), layout));
            match model.apply(payload) {
                Ok(profile) => progress.profile_progress = Some(profile.clone()),
                Err(error) => {
                    let details = vec![("error".to_string(), error.to_string())];
                    self.log(LogLevel::Warn, "Failed to apply the progress of the engine", details, LOG_TARGET);
                }
            }
        }
        self.report(QueryEvent::Progress(Box::new(progress)));
    }

    /// The schema of a result that the module converts to Arrow
    fn schema(&mut self, schema: SchemaRef) {
        if self.schema.is_none() {
            self.schema = Some(schema);
        }
    }

    /// The writer of the Arrow IPC stream of a converted result
    fn writer(&mut self, schema: SchemaRef) -> Result<&mut IpcStreamWriter, QueryFailure> {
        let schema = self.schema.get_or_insert(schema).clone();
        if self.writer.is_none() {
            self.writer = Some(IpcStreamWriter::new(&schema).map_err(write_failure)?);
        }
        self.writer.as_mut().ok_or_else(|| QueryFailure::new(FailureKind::Error, "the result has no stream"))
    }

    /// A page that the module converted to a batch arrived, the metrics count it already. The batch goes to the host
    /// as the next part of the stream.
    fn batch(&mut self, batch: RecordBatch) -> Result<(), QueryFailure> {
        if !self.publish {
            return Ok(());
        }
        let details = vec![
            ("batchColumns".to_string(), batch.num_columns().to_string()),
            ("batchRows".to_string(), batch.num_rows().to_string()),
        ];
        self.log(LogLevel::Debug, "Received result batch", details, LOG_TARGET);
        let part = self.writer(batch.schema())?.write(&batch).map_err(write_failure)?;
        drop(batch);
        self.push(Body::Bytes(part))?;
        self.report(QueryEvent::ReceivedBatch(self.metrics.clone()));
        Ok(())
    }

    /// A part of the Arrow IPC stream of the result arrived, the metrics count it already. It goes to the host as it
    /// is.
    fn part(&mut self, body: Body) -> Result<(), QueryFailure> {
        if !self.publish {
            return Ok(());
        }
        let details = vec![("bytes".to_string(), body.len().to_string())];
        self.log(LogLevel::Debug, "Received result chunk", details, LOG_TARGET);
        self.push(body)?;
        self.report(QueryEvent::ReceivedBatch(self.metrics.clone()));
        Ok(())
    }

    /// A batch arrived at the host, the metrics count it already
    fn host_batch(&mut self) {
        if self.publish {
            self.report(QueryEvent::ReceivedBatch(self.metrics.clone()));
        }
    }

    /// The end of the stream. A converted result ends its Arrow IPC stream, with the schema if no batch came.
    fn end(&mut self) -> Result<StreamEnd, QueryFailure> {
        if self.publish {
            if let Some(schema) = self.schema.clone() {
                let part = self.writer(schema)?.finish().map_err(write_failure)?;
                self.push(Body::Bytes(part))?;
            }
        }
        self.writer = None;
        Ok(StreamEnd { metrics: self.metrics.clone() })
    }

    /// Log a backend that failed to cancel a query, the query ends all the same
    fn cancel_failed(&self, message: &str) {
        let details = vec![("error".to_string(), message.to_string())];
        self.log(LogLevel::Warn, "Failed to cancel query at the backend", details, LOG_TARGET);
    }

    /// The failure of a request that the host failed, a cancelled one if the query was cancelled
    fn request_failure(&self, error: &HostError) -> QueryFailure {
        if self.token.is_cancelled() {
            QueryFailure::cancelled()
        } else {
            QueryFailure::from_host(error)
        }
    }
}

/// Stream the result of a query on its target. None if a channel of the host returned no result.
pub async fn run<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    target: &QueryTarget,
    text: &str,
) -> Result<Option<StreamEnd>, QueryFailure> {
    match target {
        QueryTarget::Host => run_host_channel(context).await,
        QueryTarget::Trino(channel) => run_trino(context, channel, text).await.map(Some),
        QueryTarget::HyperHttp { channel, auth } => run_hyper(context, channel, auth, text).await.map(Some),
        QueryTarget::ClientFunction(target) => run_client_function(context, target).await.map(Some),
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Trino
// ---------------------------------------------------------------------------------------------------------------------

/// What a future of a Trino query is
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrinoKey {
    Request(u32),
    Timer(u32),
}

/// What a future of a Trino query completed with
enum TrinoCompletion {
    Response(Result<HttpResponse, HostError>),
    Timer,
}

/// The outcome of a request as the Trino protocol reads it
fn fetch_outcome(result: Result<HttpResponse, HostError>) -> FetchOutcome {
    match result {
        Ok(response) => FetchOutcome::Response(response),
        Err(error) => FetchOutcome::NetworkError(error.message().to_string()),
    }
}

/// How long a refresh of the access token of a Trino channel may take, a refresh that takes longer fails
pub const TRINO_TOKEN_REFRESH_TIMEOUT_MS: f64 = 30.0 * 1000.0;

/// Start or join the refresh of the access token of a shared Trino channel, none if the token is fresh. The first
/// caller starts the refresh in a task of its own that runs to its end or times out, so a caller that goes away never
/// drops a refresh that others wait for. The channel keeps the new token, a failed refresh is logged, `on_end` hears
/// how the refresh that this caller started ended.
fn refresh_trino_token<H: HttpHost>(
    host: &Rc<H>,
    channel: &SharedTrinoChannel,
    on_end: impl FnOnce(Result<(), DetailedError>) + 'static,
) -> Option<Receiver<Result<(), TrinoError>>> {
    match channel.check_token(host.now() as i64) {
        TokenCheck::Fresh => None,
        TokenCheck::Pending(refreshed) => Some(refreshed),
        TokenCheck::Started { request, refreshed } => {
            let channel = channel.clone();
            let task_host = host.clone();
            host.spawn(Box::pin(async move {
                let fetched = timeout(&*task_host, TRINO_TOKEN_REFRESH_TIMEOUT_MS, task_host.fetch(request, &CancellationToken::new())).await;
                let outcome = match fetched {
                    Some(response) => fetch_outcome(response),
                    None => FetchOutcome::NetworkError("The refresh of the access token timed out".to_string()),
                };
                let finished = channel.finish_token_refresh(&outcome, task_host.now() as i64).map(|_| ());
                if let Err(error) = &finished {
                    task_host.log(LogLevel::Warn, "Failed to refresh the access token", &[("error", error.message.as_str()), ("target", LOG_TARGET)]);
                }
                on_end(finished.map_err(|error| DetailedError { message: error.message, data: error.data }));
            }));
            Some(refreshed)
        }
    }
}

/// Make sure that the access token of a shared Trino channel is fresh before a request. A token about to expire is
/// refreshed once for every query of the channel (`refresh_trino_token`), the host hears how a refresh that this query
/// started ended. None if the query was cancelled while it waited.
async fn fresh_trino_token<H: ExecutorHost>(context: &StreamContext<H>, channel: &SharedTrinoChannel) -> Option<Result<(), TrinoError>> {
    let host = context.host.clone();
    let run = context.run.clone();
    let ended = host.clone();
    let Some(refreshed) = refresh_trino_token(&host, channel, move |outcome| ended.token_refresh_ended(&run, outcome)) else {
        return Some(Ok(()));
    };
    context.token.run(refreshed).await.map(refresh_outcome)
}

/// How long the cancellation of a query at the backend may take. The query ends either way, a cancellation that takes
/// longer, e.g. once the network is gone, is given up and logged, so that a stopped run never waits for it.
pub const BACKEND_CANCEL_TIMEOUT_MS: f64 = 10.0 * 1000.0;

/// The message of a cancellation at the backend that took too long
const BACKEND_CANCEL_TIMED_OUT: &str = "The cancellation at the backend timed out";

/// Cancel a Trino query at the backend by deleting its next URI, e.g. after the query was cancelled or failed while
/// Trino still runs it. The cancellation is sent with a token of its own and given up after
/// `BACKEND_CANCEL_TIMEOUT_MS`, a failure is logged.
async fn cancel_trino<H: ExecutorHost>(context: &StreamContext<H>, channel: &SharedTrinoChannel, query: &TrinoQuery) {
    let Some(cancel) = query.cancel_request() else { return };
    let result = match channel.http_request(&cancel).map_err(|e| e.message) {
        Ok(request) => match timeout(&*context.host, BACKEND_CANCEL_TIMEOUT_MS, context.host.fetch(request, &CancellationToken::new())).await {
            None => Err(BACKEND_CANCEL_TIMED_OUT.to_string()),
            Some(response) => response
                .map_err(|e| e.message().to_string())
                .and_then(|response| crate::trino::read_cancel_response(&FetchOutcome::Response(response)).map_err(|e| e.message)),
        },
        Err(message) => Err(message),
    };
    if let Err(message) = result {
        context.cancel_failed(&message);
    }
}

async fn run_trino<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    channel: &SharedTrinoChannel,
    text: &str,
) -> Result<StreamEnd, QueryFailure> {
    let host = context.host.clone();
    let now = || host.now() as i64;
    let options = TrinoQueryOptions { time_zones: host.time_zones(), ..Default::default() };
    let (mut query, outputs) = TrinoQuery::start(text, options, now());
    let streamed = stream_trino(context, channel, &mut query, outputs).await;
    match &streamed {
        // A cancelled query or one that failed while Trino may still run it stops at the backend
        Err(failure) if failure.kind == FailureKind::Cancelled || context.token.is_cancelled() => {
            cancel_trino(context, channel, &query).await;
            query.abort();
            return Err(QueryFailure::cancelled());
        }
        Err(_) => {
            cancel_trino(context, channel, &query).await;
            query.abort();
        }
        Ok(_) => {}
    }
    streamed
}

/// Stream the result of a Trino query to its end
async fn stream_trino<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    channel: &SharedTrinoChannel,
    query: &mut TrinoQuery,
    outputs: Vec<StreamOutput>,
) -> Result<StreamEnd, QueryFailure> {
    let host = context.host.clone();
    let now = || host.now() as i64;
    let mut queue: VecDeque<StreamOutput> = outputs.into();
    // The profile is fetched while a view shows it, the statement asks for it once the stages exist
    context.run.controls().clear_changed();
    queue.extend(query.set_profile_detail(context.run.controls().profile_shown(), now()));
    let mut pending: TaskSet<TrinoKey, TrinoCompletion> = TaskSet::new();
    let mut statement: Option<u32> = None;
    loop {
        while let Some(output) = queue.pop_front() {
            match output {
                StreamOutput::Send { id, request } => {
                    statement.get_or_insert(id);
                    // An access token about to expire is refreshed before the request
                    match fresh_trino_token(context, channel).await {
                        None => return Err(QueryFailure::cancelled()),
                        Some(Err(error)) => {
                            queue.extend(query.on_request_failed(id, error, now()));
                            continue;
                        }
                        Some(Ok(())) => {}
                    }
                    match channel.http_request(&request) {
                        Ok(http) => {
                            let response = host.fetch(http, &context.token);
                            pending.push(TrinoKey::Request(id), async move { TrinoCompletion::Response(response.await) });
                        }
                        Err(error) => queue.extend(query.on_request_failed(id, error, now())),
                    }
                }
                StreamOutput::StartTimer { id, delay_ms } => {
                    let sleep = host.sleep(delay_ms as f64);
                    pending.push(TrinoKey::Timer(id), async move {
                        sleep.await;
                        TrinoCompletion::Timer
                    });
                }
                StreamOutput::ClearTimer { id } => pending.remove(TrinoKey::Timer(id)),
                StreamOutput::Schema(schema) => context.schema(schema),
                StreamOutput::Progress(progress) => {
                    context.metrics = progress.metrics.clone();
                    context.progress(progress);
                }
                StreamOutput::Batch(batch) => {
                    context.metrics = query.metrics().clone();
                    context.batch(batch)?;
                }
                StreamOutput::Warning { message, error } => {
                    let mut details = vec![("error".to_string(), error.message.clone())];
                    details.extend(error.data.clone());
                    context.log(LogLevel::Warn, &message, details, "trino_channel");
                }
                StreamOutput::Finished => {
                    context.metrics = query.metrics().clone();
                    return context.end();
                }
                StreamOutput::Failed(error) => {
                    context.metrics = query.metrics().clone();
                    return Err(error.into());
                }
            }
        }
        match next(&mut pending, &context.token, context.run.controls()).await {
            Wake::Cancelled => return Err(QueryFailure::cancelled()),
            Wake::Control => queue.extend(query.set_profile_detail(context.run.controls().profile_shown(), now())),
            Wake::Done(TrinoKey::Request(id), TrinoCompletion::Response(result)) => {
                let outputs = query.on_response(id, &fetch_outcome(result), now());
                // The answer to the statement opens the result stream
                if statement == Some(id) && !outputs.iter().any(|output| matches!(output, StreamOutput::Failed(_))) {
                    context.metrics = query.metrics().clone();
                    context.running();
                }
                queue.extend(outputs);
            }
            Wake::Done(TrinoKey::Timer(id), _) | Wake::Done(TrinoKey::Request(id), TrinoCompletion::Timer) => {
                queue.extend(query.on_timer(id, now()));
            }
            Wake::Idle => return Err(QueryFailure::new(FailureKind::Error, "The Trino query stalled")),
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Hyper over HTTP
// ---------------------------------------------------------------------------------------------------------------------

async fn run_hyper<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    channel: &HyperHttpChannel,
    auth: &Headers,
    text: &str,
) -> Result<StreamEnd, QueryFailure> {
    let host = context.host.clone();
    let response = match context.token.run(host.fetch_result(channel.execute_query(text, auth), &context.token)).await {
        None => return Err(QueryFailure::cancelled()),
        Some(Err(error)) => return Err(context.request_failure(&error)),
        Some(Ok(response)) => response,
    };
    let mut reader = channel.open_result(response, host.now() as i64)?;
    context.running();
    let mut auth = auth.clone();
    let streamed = stream_hyper(context, &mut reader, &mut auth).await;
    if let Err((failure, at_backend)) = &streamed {
        // A cancelled query, or one whose result broke off while Hyper may still run it, stops at the backend
        let cancelled = failure.kind == FailureKind::Cancelled || context.token.is_cancelled();
        if cancelled || *at_backend {
            let result = match timeout(&*host, BACKEND_CANCEL_TIMEOUT_MS, host.fetch(reader.cancel_request(&auth), &CancellationToken::new())).await {
                None => Err(BACKEND_CANCEL_TIMED_OUT.to_string()),
                Some(result) => result
                    .map_err(|e| e.message().to_string())
                    .and_then(|response| crate::hyper::read_cancel_response(&response).map_err(|e| e.message())),
            };
            if let Err(message) = result {
                context.cancel_failed(&message);
            }
        }
        if cancelled {
            return Err(QueryFailure::cancelled());
        }
    }
    streamed.map_err(|(failure, _)| failure)
}

/// Stream the result of a Hyper query to its end. A failure says whether Hyper may still run the query: the result
/// broke off in the network or the protocol, not with an error of the query.
async fn stream_hyper<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    reader: &mut crate::hyper::HyperResultReader,
    auth: &mut Headers,
) -> Result<StreamEnd, (QueryFailure, bool)> {
    let host = context.host.clone();
    let broken = |error: crate::hyper::HyperError| {
        let at_backend = !matches!(error, crate::hyper::HyperError::Query(_));
        (QueryFailure::from(error), at_backend)
    };
    let mut pending: TaskSet<u64, Result<HttpResponse, HostError>> = TaskSet::new();
    loop {
        // The auth headers of the channel may change while a result streams, e.g. a token that is refreshed. The
        // requests of every round ask for them again.
        match context.token.run(host.channel_auth(&context.run)).await {
            None => return Err((QueryFailure::cancelled(), true)),
            Some(Ok(Some(headers))) => *auth = headers,
            Some(Ok(None)) => {}
            Some(Err(error)) => return Err((context.request_failure(&error), true)),
        }
        let poll = reader.poll(auth).map_err(broken)?;
        for event in poll.events {
            context.metrics.total_data_bytes_received = reader.metrics().total_data_bytes_received;
            match event {
                ResultEvent::Progress(mut progress) => {
                    progress.metrics = context.metrics.clone();
                    context.progress(progress);
                }
                // The chunks count as the batches until the host counts the batches of the result
                ResultEvent::Chunk(body) => {
                    context.metrics.total_batches_received += 1;
                    context.part(body).map_err(|failure| (failure, true))?;
                }
            }
        }
        for request in poll.requests {
            if request.chunk {
                pending.push(request.id, host.fetch_result(request.request, &context.token));
            } else {
                pending.push(request.id, host.fetch(request.request, &context.token));
            }
        }
        if poll.done {
            return context.end().map_err(|failure| (failure, false));
        }
        match next(&mut pending, &context.token, context.run.controls()).await {
            Wake::Cancelled => return Err((QueryFailure::cancelled(), true)),
            Wake::Control => {}
            Wake::Done(id, Ok(response)) => reader.receive(id, response, host.now() as i64).map_err(broken)?,
            Wake::Done(_, Err(error)) => return Err((context.request_failure(&error), true)),
            Wake::Idle => return Err((QueryFailure::new(FailureKind::Error, "The Hyper query stalled"), true)),
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------------------------------------------------

async fn run_client_function<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    target: &ClientFunctionTarget,
) -> Result<StreamEnd, QueryFailure> {
    let host = context.host.clone();
    let Some(spec) = target.spec.clone() else {
        // The connector has no binding, starting the call names it
        return Err(start_without_spec(target));
    };
    match start_connection_client_function(target.connector, spec, &target.description, host.now())? {
        ConnectionCallStart::Explained(result) => client_function_rows(context, result)?,
        ConnectionCallStart::Running { binding, mut run, mut step } => loop {
            // The rows of a page go to the host once the page arrived
            if let Some(rows) = run.take_rows() {
                client_function_rows(context, rows)?;
            }
            step = match step {
                CallStep::Send(request) => {
                    let credentials = ConnectionCredentials::Salesforce(target.tokens.as_ref());
                    let http = binding.http_request(credentials, &request, host.now())?;
                    context.metrics.total_query_requests_started += 1;
                    let started_at = host.now();
                    let response = match context.token.run(host.fetch(http, &context.token)).await {
                        None => return Err(QueryFailure::cancelled()),
                        Some(Err(error)) => {
                            context.metrics.total_query_requests_failed += 1;
                            return Err(context.request_failure(&error));
                        }
                        Some(Ok(response)) => response,
                    };
                    context.metrics.total_query_requests_succeeded += 1;
                    context.metrics.total_query_request_duration_ms += (host.now() - started_at) as i64;
                    context.metrics.total_data_bytes_received += response.body.len() as u64;
                    run.on_response(response, host.now())?
                }
                CallStep::Sleep { ms } => {
                    if context.token.run(host.sleep(ms)).await.is_none() {
                        return Err(QueryFailure::cancelled());
                    }
                    run.on_wake(host.now())?
                }
                CallStep::Done => {
                    // A result without rows has the columns of the function
                    context.running();
                    context.schema(ClientFunctionResult { fields: run.fields(), rows: Vec::new() }.schema());
                    break;
                }
            };
        },
    }
    context.end()
}

/// The rows of a page of a client function call: the result streams once the first page arrived
fn client_function_rows<H: ExecutorHost>(
    context: &mut StreamContext<H>,
    rows: ClientFunctionResult,
) -> Result<(), QueryFailure> {
    let batch = rows.to_record_batch()?;
    drop(rows);
    context.running();
    context.metrics.total_batches_received += 1;
    context.metrics.total_rows_received += batch.num_rows() as u64;
    context.batch(batch)
}

/// The failure of a call on a connector without client functions
fn start_without_spec(target: &ClientFunctionTarget) -> QueryFailure {
    let name = target.connector.connector().display_name();
    QueryFailure::new(FailureKind::Error, format!("{name} connections have no client functions"))
}

// ---------------------------------------------------------------------------------------------------------------------
// Channels of the host
// ---------------------------------------------------------------------------------------------------------------------

/// Cancel the query of a channel: one that the channel still opens, or its stream at the backend. A failure is logged.
async fn cancel_host_channel<H: ExecutorHost>(context: &StreamContext<H>) {
    if let Err(error) = context.host.channel_cancel(&context.run).await {
        context.cancel_failed(error.message());
    }
}

async fn run_host_channel<H: ExecutorHost>(context: &mut StreamContext<H>) -> Result<Option<StreamEnd>, QueryFailure> {
    let host = context.host.clone();
    let run = context.run.clone();
    // A cancel while the channel opens the query, e.g. while it waits for the query before it, stops it there: the open
    // fails, or it returns a stream that is cancelled below
    let mut open = Box::pin(host.channel_open(&run));
    let opened = context.token.run(&mut open).await;
    let opened = match opened {
        Some(opened) => opened,
        None => {
            cancel_host_channel(context).await;
            open.await
        }
    };
    let has_stream = match opened {
        Ok(has_stream) => has_stream,
        Err(error) => return Err(context.request_failure(&error)),
    };
    if !has_stream {
        if context.token.is_cancelled() {
            return Err(QueryFailure::cancelled());
        }
        return Ok(None);
    }
    if context.token.is_cancelled() {
        cancel_host_channel(context).await;
        return Err(QueryFailure::cancelled());
    }
    context.running();
    run.controls().clear_changed();
    host.channel_profile_detail(&run, run.controls().profile_shown());
    let mut pending: TaskSet<(), Result<ChannelMessage, HostError>> = TaskSet::new();
    loop {
        if pending.is_empty() {
            pending.push((), host.channel_next(&run));
        }
        match next(&mut pending, &context.token, run.controls()).await {
            Wake::Cancelled => {
                cancel_host_channel(context).await;
                // The query ends with its stream, the channel stops it on the cancellation
                pending.settle().await;
                return Err(QueryFailure::cancelled());
            }
            Wake::Control => host.channel_profile_detail(&run, run.controls().profile_shown()),
            Wake::Done((), Ok(ChannelMessage::Progress(progress))) => context.progress(*progress),
            Wake::Done((), Ok(ChannelMessage::Batch { metrics })) => {
                context.metrics = metrics;
                context.host_batch();
            }
            Wake::Done((), Ok(ChannelMessage::End { metrics })) => {
                context.metrics = metrics;
                return context.end().map(Some);
            }
            Wake::Done((), Err(error)) => return Err(context.request_failure(&error)),
            Wake::Idle => return Err(QueryFailure::new(FailureKind::Error, "The channel stalled")),
        }
    }
}
