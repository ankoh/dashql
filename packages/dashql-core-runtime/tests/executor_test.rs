// The query executor on a fake host: an executor of a single thread, a clock that only the test advances, an HTTP
// server of answers and a channel of the host. A query is cancelled through the token of its run, the one
// cancellation of the runtime.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use arrow_array::{Int32Array, RecordBatch};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use serde_json::{json, Value};

use dashql_buffers::profile as fb;
use dashql_core_runtime::clfn::{ClientFunctionCallDescription, ClientFunctionSpec};
use dashql_core_runtime::connections::{ConnectorType, DetailedError, TrinoSessionDefaults};
use dashql_core_runtime::executor::connectors::{BACKEND_CANCEL_TIMEOUT_MS, TRINO_TOKEN_REFRESH_TIMEOUT_MS};
use dashql_core_runtime::executor::ipc::{read_stream, write_stream};
use dashql_core_runtime::executor::{
    ChannelMessage, ClientFunctionTarget, ExecutorHost, ExecutorRun, FailureKind, HostTable, QueryControls, QueryEvent,
    QueryExecutor, QueryId, QueryOutcome, QueryRequest, QueryTarget, ResultRequest, StoredFile,
};
use dashql_core_runtime::host::signal::{oneshot, Receiver};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{
    Body, CancellationToken, Headers, HostBytes, HttpHost, HttpMethod, HttpRequest, HttpResponse,
};
use dashql_core_runtime::hyper::{HyperChannelContext, HyperHttpChannel};
use dashql_core_runtime::query::progress::{EngineProgressPayload, HyperQueryStatus};
use dashql_core_runtime::query::{QueryExecutionMetrics, QueryExecutionProgress};
use dashql_core_runtime::salesforce::client_functions::DATA_360_API_VERSION;
use dashql_core_runtime::salesforce::SalesforceTokens;
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_runtime::trino::protocol::ACCESS_TOKEN_REFRESH_MARGIN_MS;
use dashql_core_runtime::trino::{
    SharedTrinoChannel, TrinoAccessToken, TrinoAuthParams, TrinoAuthType, TrinoChannel, TrinoOAuthParams,
    DEFAULT_TRINO_RETRY_POLICY, TARGET_RESULT_SIZE,
};

const TRINO: &str = "https://trino.example.com";
const HYPER: &str = "https://hyper.example";

// The executor

struct TaskWaker {
    id: u64,
    queue: Arc<Mutex<VecDeque<u64>>>,
}

impl Wake for TaskWaker {
    fn wake(self: Arc<Self>) {
        self.queue.lock().unwrap().push_back(self.id);
    }
}

#[derive(Default)]
struct Executor {
    tasks: RefCell<HashMap<u64, LocalTask>>,
    queue: Arc<Mutex<VecDeque<u64>>>,
    next_id: Cell<u64>,
}

impl Executor {
    fn spawn(&self, task: LocalTask) {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        self.tasks.borrow_mut().insert(id, task);
        self.queue.lock().unwrap().push_back(id);
    }

    fn run_until_stalled(&self) {
        loop {
            let Some(id) = self.queue.lock().unwrap().pop_front() else { return };
            let Some(mut task) = self.tasks.borrow_mut().remove(&id) else { continue };
            let waker = Waker::from(Arc::new(TaskWaker { id, queue: self.queue.clone() }));
            if task.as_mut().poll(&mut Context::from_waker(&waker)).is_pending() {
                self.tasks.borrow_mut().insert(id, task);
            }
        }
    }
}

// The clock

struct TimerSlot {
    fired: Cell<bool>,
    waker: RefCell<Option<Waker>>,
}

#[derive(Default)]
struct Clock {
    now: Cell<u64>,
    next_seq: Cell<u64>,
    timers: RefCell<BTreeMap<(u64, u64), Rc<TimerSlot>>>,
}

struct Sleep {
    clock: Rc<Clock>,
    key: (u64, u64),
    slot: Rc<TimerSlot>,
}

impl Future for Sleep {
    type Output = ();

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<()> {
        if self.slot.fired.get() {
            return Poll::Ready(());
        }
        *self.slot.waker.borrow_mut() = Some(cx.waker().clone());
        Poll::Pending
    }
}

impl Drop for Sleep {
    fn drop(&mut self) {
        self.clock.timers.borrow_mut().remove(&self.key);
    }
}

// The host

/// How the server answers a request
enum Answer {
    Now(Result<HttpResponse, HostError>),
    /// Never, until the request is cancelled
    Hold,
    /// Once the test sends the answer, a request that is cancelled meanwhile is aborted
    Later(Receiver<HttpResponse>),
}

type Server = Box<dyn FnMut(&HttpRequest) -> Answer>;

#[derive(Default)]
struct State {
    /// The events of the queries without the logs
    events: Vec<String>,
    /// The timings of the results, kept apart from the events: they are no step of the lifecycle
    timings: Vec<f64>,
    /// The progress updates of the queries
    progress: Vec<QueryExecutionProgress>,
    logs: Vec<(LogLevel, String, Vec<(String, String)>)>,
    sent: Vec<HttpRequest>,
    /// The rows of the result tables by query
    results: HashMap<QueryId, usize>,
    /// The parts of the result streams by query, until the result is finished
    parts: HashMap<QueryId, Vec<Vec<u8>>>,
    /// The parts that stayed with the host
    host_parts: usize,
    /// The rows of the batches of the channel so far
    channel_rows: u64,
    /// Does `fetch_result` keep the body of a successful response, like the module?
    keep_bodies: bool,
    /// The messages of the channel, the channel holds once they ran out
    channel: VecDeque<Result<ChannelMessage, HostError>>,
    /// Does the channel return a stream?
    channel_stream: bool,
    channel_calls: Vec<String>,
    channel_cancel_fails: bool,
    /// The files of the stored results by name
    files: HashMap<String, ()>,
    cache_calls: Vec<String>,
    /// Cancelled with the query of the channel, a stream that waits for a message then fails
    channel_aborted: CancellationToken,
    cache_read_fails: bool,
    cache_write_fails: bool,
    /// The next read of a stored result waits for this
    cache_read_later: Option<Receiver<()>>,
    analysis_fails: bool,
    /// Does the analysis wait until its query is cancelled?
    analysis_holds: bool,
    /// Does the channel wait with the open until it is cancelled, like a query that waits for the query before it?
    open_holds: bool,
    /// The answer of the next open of the channel, it waits for it whether the query is cancelled or not
    open_later: Option<Receiver<bool>>,
    /// How the refreshes of the tokens of channels ended, by query
    refreshes: Vec<(QueryId, Result<(), DetailedError>)>,
    /// The auth headers of the Hyper channel as they are now, none keeps those of the query
    hyper_auth: Option<Headers>,
}

struct FakeHost {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
    state: RefCell<State>,
    server: RefCell<Option<Server>>,
    /// The requests that the host aborted, by their URL
    aborted: Rc<RefCell<Vec<String>>>,
    /// The tables that the reads of the cache handed to the runs, by query
    cache_tables: Rc<RefCell<Vec<QueryId>>>,
    /// The starts and the ends of the analyses: `start`, `end:ok`, `end:failed`, `end:cancelled`
    analyses: Rc<RefCell<Vec<String>>>,
}

impl FakeHost {
    fn new() -> Rc<Self> {
        Rc::new(Self {
            executor: Rc::default(),
            clock: Rc::default(),
            state: RefCell::new(State { channel_stream: true, ..State::default() }),
            server: RefCell::new(None),
            aborted: Rc::default(),
            cache_tables: Rc::default(),
            analyses: Rc::default(),
        })
    }

    fn serve(&self, server: impl FnMut(&HttpRequest) -> Answer + 'static) {
        *self.server.borrow_mut() = Some(Box::new(server));
    }

    /// Advance the clock, firing the timers on the way
    fn advance(&self, ms: u64) {
        let until = self.clock.now.get() + ms;
        loop {
            self.executor.run_until_stalled();
            let first = self.clock.timers.borrow().iter().next().map(|(key, slot)| (*key, slot.clone()));
            match first {
                Some(((at, seq), slot)) if at <= until => {
                    self.clock.now.set(at);
                    self.clock.timers.borrow_mut().remove(&(at, seq));
                    slot.fired.set(true);
                    if let Some(waker) = slot.waker.borrow_mut().take() {
                        waker.wake();
                    }
                }
                _ => break,
            }
        }
        self.clock.now.set(until);
        self.executor.run_until_stalled();
    }

    fn events(&self) -> Vec<String> {
        self.state.borrow().events.clone()
    }

    fn log_messages(&self) -> Vec<String> {
        self.state.borrow().logs.iter().map(|(_, message, _)| message.clone()).collect()
    }
}

/// A future of the host
type Boxed<T> = Pin<Box<dyn Future<Output = T>>>;

fn aborted(token: &CancellationToken) -> Boxed<Result<HttpResponse, HostError>> {
    let cancelled = token.cancelled();
    Box::pin(async move {
        cancelled.await;
        Err(HostError::new("aborted"))
    })
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        self.clock.now.get() as f64
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let seq = self.clock.next_seq.get();
        self.clock.next_seq.set(seq + 1);
        let key = (self.clock.now.get() + ms.max(0.0).round() as u64, seq);
        let slot = Rc::new(TimerSlot { fired: Cell::new(false), waker: RefCell::new(None) });
        self.clock.timers.borrow_mut().insert(key, slot.clone());
        Sleep { clock: self.clock.clone(), key, slot }
    }

    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, _details: &[(&str, &str)]) {
        self.state.borrow_mut().logs.push((level, message.to_string(), Vec::new()));
    }

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl HttpHost for FakeHost {
    fn fetch(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.state.borrow_mut().sent.push(request.clone());
        let answer = match self.server.borrow_mut().as_mut() {
            Some(server) => server(&request),
            None => Answer::Now(Err(HostError::new("no server"))),
        };
        let future: Boxed<Result<HttpResponse, HostError>> = match answer {
            Answer::Now(result) => Box::pin(std::future::ready(result)),
            Answer::Hold => aborted(cancellation),
            Answer::Later(answer) => {
                let cancelled = cancellation.clone();
                Box::pin(async move {
                    match cancelled.run(answer).await {
                        Some(Some(response)) => Ok(response),
                        _ => Err(HostError::new("aborted")),
                    }
                })
            }
        };
        // Like the module, the host aborts a request whose future is dropped before it completed
        let guard = AbortGuard { url: request.url.clone(), aborted: self.aborted.clone(), done: false };
        Box::pin(async move {
            let mut guard = guard;
            let result = future.await;
            guard.done = true;
            result
        }) as Boxed<Result<HttpResponse, HostError>>
    }
}

/// Records the URL of a request whose future was dropped before it completed
struct AbortGuard {
    url: String,
    aborted: Rc<RefCell<Vec<String>>>,
    done: bool,
}

impl Drop for AbortGuard {
    fn drop(&mut self) {
        if !self.done {
            self.aborted.borrow_mut().push(self.url.clone());
        }
    }
}

fn event_name(event: &QueryEvent) -> Option<String> {
    Some(match event {
        QueryEvent::Sending => "sending".into(),
        QueryEvent::Running => "running".into(),
        QueryEvent::Progress(progress) => format!("progress:{}", progress.phase.clone().unwrap_or_default()),
        QueryEvent::ReceivedBatch(metrics) => format!("batch:{}", metrics.total_rows_received),
        QueryEvent::ReceivedAllBatches { rows, .. } => format!("all:{rows}"),
        QueryEvent::Succeeded => "succeeded".into(),
        QueryEvent::Failed { failure, .. } => format!("failed:{}", failure.message),
        QueryEvent::Cancelled { .. } => "cancelled".into(),
        QueryEvent::CacheRecorded { served_from_cache } => format!("cache:{served_from_cache}"),
        QueryEvent::TouchRelations => "touch".into(),
        QueryEvent::Timing { .. } => return None,
        QueryEvent::Log { .. } => return None,
    })
}

/// The run of a query as the host keeps it: its id, its token and its controls
#[derive(Default)]
struct FakeRun {
    query_id: QueryId,
    token: CancellationToken,
    controls: QueryControls,
}

impl ExecutorRun for FakeRun {
    fn query_id(&self) -> QueryId {
        self.query_id
    }

    fn token(&self) -> &CancellationToken {
        &self.token
    }

    fn controls(&self) -> &QueryControls {
        &self.controls
    }
}

/// Wait for a value that the test sends, a value that never comes fails
fn later<T: 'static>(receiver: Receiver<T>, what: &'static str) -> Boxed<Result<T, HostError>> {
    Box::pin(async move { receiver.await.ok_or_else(|| HostError::new(what)) })
}

impl ExecutorHost for FakeHost {
    type Run = FakeRun;

    fn report(&self, run: &FakeRun, event: QueryEvent) {
        let mut state = self.state.borrow_mut();
        if let QueryEvent::Log { level, message, details, .. } = &event {
            state.logs.push((*level, message.clone(), details.clone()));
            return;
        }
        match &event {
            QueryEvent::ReceivedAllBatches { rows, .. } => {
                state.results.insert(run.query_id, *rows as usize);
            }
            QueryEvent::Progress(progress) => state.progress.push((**progress).clone()),
            QueryEvent::Timing { elapsed_ms } => state.timings.push(*elapsed_ms),
            _ => {}
        }
        if let Some(name) = event_name(&event) {
            state.events.push(name);
        }
    }

    fn push_result(&self, run: &FakeRun, part: Body) -> Result<(), HostError> {
        let mut state = self.state.borrow_mut();
        // The parts of the result stay with the host
        let part = match part {
            Body::Bytes(bytes) => bytes,
            Body::Host(bytes) => {
                state.host_parts += 1;
                bytes
                    .value()
                    .downcast_ref::<Vec<u8>>()
                    .cloned()
                    .ok_or_else(|| HostError::new("no bytes of the host"))?
            }
        };
        state.parts.entry(run.query_id).or_default().push(part);
        Ok(())
    }

    fn finish_result(&self, run: &Rc<FakeRun>) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        // The host builds the table from the parts of the stream, or from the batches of its channel
        let table = match state.parts.remove(&run.query_id) {
            Some(parts) => read_stream(&parts.concat()).map_err(HostError::new).map(|(schema, batches)| HostTable {
                rows: batches.iter().map(|batch| batch.num_rows() as u64).sum(),
                columns: schema.fields().len() as u64,
                batches: batches.len() as u64,
            }),
            None => Ok(HostTable { rows: state.channel_rows, columns: 1, batches: 1 }),
        };
        std::future::ready(table)
    }

    fn result_read(
        &self,
        run: &Rc<FakeRun>,
        _workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<HostTable>, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.cache_calls.push(format!("read:{name}"));
        let exists = state.files.contains_key(name);
        let fails = state.cache_read_fails;
        let wait = state.cache_read_later.take();
        let tables = self.cache_tables.clone();
        let query_id = run.query_id;
        async move {
            if let Some(wait) = wait {
                wait.await;
            }
            if fails {
                return Err(HostError::new("corrupt parquet"));
            }
            if !exists {
                return Ok(None);
            }
            // The run owns the table that was read
            tables.borrow_mut().push(query_id);
            Ok(Some(HostTable { rows: 1, columns: 1, batches: 1 }))
        }
    }

    fn result_write(
        &self,
        _run: &Rc<FakeRun>,
        result: &ResultRequest,
    ) -> impl Future<Output = Result<String, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.cache_calls.push(format!("write:{}:{}", result.script, result.key));
        let outcome = if state.cache_write_fails {
            Err(HostError::new("quota exceeded"))
        } else {
            Ok(format!("{}.{}.parquet", result.script, result.key))
        };
        std::future::ready(outcome)
    }

    fn result_clear(&self, _workbook_id: &str, script: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.state.borrow_mut().cache_calls.push(format!("clear:{script}"));
        std::future::ready(Ok(()))
    }

    fn analyze_result(&self, run: &Rc<FakeRun>) -> impl Future<Output = Result<(), HostError>> + 'static {
        let state = self.state.borrow();
        // The analysis starts with the call
        self.analyses.borrow_mut().push("start".into());
        let (fails, holds) = (state.analysis_fails, state.analysis_holds);
        let cancelled = run.token.cancelled();
        let analyses = self.analyses.clone();
        async move {
            let end = if holds {
                cancelled.await;
                Err(HostError::cancelled())
            } else if fails {
                Err(HostError::new("no compute"))
            } else {
                Ok(())
            };
            let name = match &end {
                Ok(()) => "end:ok",
                Err(error) if error.is_cancelled() => "end:cancelled",
                Err(_) => "end:failed",
            };
            analyses.borrow_mut().push(name.into());
            end
        }
    }

    fn fetch_result(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let keep = self.state.borrow().keep_bodies;
        let fetch = self.fetch(request, cancellation);
        async move {
            let mut response = fetch.await?;
            if keep && response.status < 400 {
                let bytes = std::mem::take(&mut response.body);
                let length = bytes.len();
                response.host_body = Some(HostBytes::new(Rc::new(bytes), length));
            }
            Ok(response)
        }
    }

    fn channel_open(&self, _run: &Rc<FakeRun>) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.channel_calls.push("open".into());
        if let Some(answer) = state.open_later.take() {
            return later(answer, "no answer");
        }
        if state.open_holds {
            // The query waits for its turn until the channel is cancelled
            let aborted = state.channel_aborted.cancelled();
            return Box::pin(async move {
                aborted.await;
                Err(HostError::new("aborted"))
            });
        }
        Box::pin(std::future::ready(Ok(state.channel_stream)))
    }

    fn channel_next(&self, _run: &FakeRun) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static {
        let message = self.state.borrow_mut().channel.pop_front();
        if let Some(Ok(ChannelMessage::Batch { metrics })) = &message {
            self.state.borrow_mut().channel_rows = metrics.total_rows_received;
        }
        let future: Boxed<Result<ChannelMessage, HostError>> = match message {
            Some(message) => Box::pin(std::future::ready(message)),
            None => {
                let aborted = self.state.borrow().channel_aborted.cancelled();
                Box::pin(async move {
                    aborted.await;
                    Err(HostError::new("aborted"))
                })
            }
        };
        future
    }

    fn channel_cancel(&self, _run: &FakeRun) -> impl Future<Output = Result<(), HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.channel_calls.push("cancel".into());
        state.channel_aborted.cancel();
        let fails = state.channel_cancel_fails;
        std::future::ready(if fails { Err(HostError::new("backend gone")) } else { Ok(()) })
    }

    fn channel_auth(&self, _run: &FakeRun) -> impl Future<Output = Result<Option<Headers>, HostError>> + 'static {
        std::future::ready(Ok(self.state.borrow().hyper_auth.clone()))
    }

    fn token_refresh_ended(&self, run: &FakeRun, outcome: Result<(), DetailedError>) {
        self.state.borrow_mut().refreshes.push((run.query_id(), outcome));
    }
}

// Helpers

/// A query of a test: its request and its run. It reads as its request.
struct TestQuery {
    request: QueryRequest,
    run: Rc<FakeRun>,
}

impl std::ops::Deref for TestQuery {
    type Target = QueryRequest;

    fn deref(&self) -> &QueryRequest {
        &self.request
    }
}

impl std::ops::DerefMut for TestQuery {
    fn deref_mut(&mut self) -> &mut QueryRequest {
        &mut self.request
    }
}

fn request(query_id: QueryId, target: QueryTarget) -> TestQuery {
    let request = QueryRequest {
        connection_id: "c".into(),
        text: "select 1".into(),
        target,
        publish_results: true,
        analyze_results: false,
        result: None,
        touches_relations: false,
        throw_on_error: false,
        log_details: vec![("workbookId".into(), "w".into())],
    };
    TestQuery { request, run: Rc::new(FakeRun { query_id, ..FakeRun::default() }) }
}

/// Start a query, the outcome arrives in the cell
fn start(
    host: &Rc<FakeHost>,
    executor: &QueryExecutor<FakeHost>,
    query: TestQuery,
) -> Rc<RefCell<Option<QueryOutcome>>> {
    let outcome = Rc::new(RefCell::new(None));
    let slot = outcome.clone();
    let future = executor.execute(query.request, query.run);
    host.executor.spawn(Box::pin(async move {
        *slot.borrow_mut() = Some(future.await);
    }));
    outcome
}

fn run(host: &Rc<FakeHost>, executor: &QueryExecutor<FakeHost>, query: TestQuery) -> QueryOutcome {
    let outcome = start(host, executor, query);
    host.advance(0);
    let outcome = outcome.borrow_mut().take();
    outcome.expect("the query ended")
}

fn resolved(outcome: &QueryOutcome) -> Option<bool> {
    match outcome {
        QueryOutcome::Resolved { has_result } => Some(*has_result),
        QueryOutcome::Rejected(_) => None,
    }
}

fn schema() -> SchemaRef {
    Arc::new(Schema::new(vec![Field::new("n", DataType::Int32, true)]))
}

fn batch_ipc(values: &[i32]) -> Vec<u8> {
    let batch = RecordBatch::try_new(schema(), vec![Arc::new(Int32Array::from(values.to_vec()))]).unwrap();
    write_stream(&schema(), &[batch]).unwrap()
}

/// The parts of the result streams that the host received
fn part_count(host: &FakeHost, query_id: QueryId) -> usize {
    host.state.borrow().parts.get(&query_id).map_or(0, Vec::len)
}

fn json_response(value: Value) -> Answer {
    Answer::Now(Ok(HttpResponse::new(200, value.to_string())))
}

fn trino_channel() -> SharedTrinoChannel {
    let auth = TrinoAuthParams {
        auth_type: TrinoAuthType::Basic,
        username: "user".into(),
        secret: "secret".into(),
        oauth: None,
    };
    SharedTrinoChannel::new(TrinoChannel::new(TRINO, auth, TrinoSessionDefaults::default()))
}

const TOKEN_URL: &str = "https://idp.example.com/token";

/// A Trino channel with OAuth whose access token expires at a time
fn oauth_trino_channel(expires_at: i64) -> SharedTrinoChannel {
    let oauth = TrinoOAuthParams { token_url: TOKEN_URL.into(), client_id: "dashql".into(), ..Default::default() };
    let auth = TrinoAuthParams { auth_type: TrinoAuthType::OAuth, oauth: Some(oauth), ..Default::default() };
    let mut channel = TrinoChannel::new(TRINO, auth, TrinoSessionDefaults::default());
    channel.access_token = Some(TrinoAccessToken {
        created_at: 0,
        access_token: "token-1".into(),
        token_type: "Bearer".into(),
        refresh_token: Some("refresh-1".into()),
        expires_at: Some(expires_at),
        scope: None,
    });
    SharedTrinoChannel::new(channel)
}

/// The answer of the token endpoint with a new access token and a rotated refresh token
fn token_answer(token: &str) -> HttpResponse {
    HttpResponse::new(
        200,
        json!({ "access_token": token, "refresh_token": format!("refresh-of-{token}"), "expires_in": 3600 })
            .to_string(),
    )
}

fn next_uri(page: u32) -> String {
    format!("{TRINO}/v1/statement/executing/q1/y/{page}")
}

/// A Trino server: the statement, then the pages in order
fn trino_server(host: &FakeHost, pages: Vec<Answer>) {
    let mut pages: VecDeque<Answer> = pages.into();
    host.serve(move |request| {
        if request.method == HttpMethod::Delete {
            return Answer::Now(Ok(HttpResponse::new(204, "")));
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(
                json!({ "id": "q1", "nextUri": next_uri(1), "stats": { "state": "QUEUED", "queued": true } }),
            );
        }
        pages.pop_front().unwrap_or(Answer::Hold)
    });
}

fn trino_page(next: Option<u32>, rows: Option<Value>, state: &str) -> Answer {
    let mut page = json!({ "id": "q1", "columns": [{ "name": "n", "type": "integer" }], "stats": { "state": state } });
    if let Some(next) = next {
        page["nextUri"] = json!(next_uri(next));
    }
    if let Some(rows) = rows {
        page["data"] = rows;
    }
    json_response(page)
}

// Trino

#[test]
fn trino_streams_the_pages_of_a_query() {
    let host = FakeHost::new();
    trino_server(
        &host,
        vec![trino_page(Some(2), Some(json!([[1], [2]])), "RUNNING"), trino_page(None, Some(json!([[3]])), "FINISHED")],
    );
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::Trino(trino_channel())));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(
        host.events(),
        [
            "sending",
            "running",
            "progress:QUEUED",
            "progress:RUNNING",
            "batch:2",
            "progress:FINISHED",
            "batch:3",
            "all:3",
            "succeeded"
        ]
    );
    assert_eq!(host.state.borrow().timings.len(), 1);
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
    // The statement stats go into the progress model of the query, every update carries its structured progress
    let progress = host.state.borrow().progress.clone();
    assert_eq!(progress.len(), 3);
    assert!(progress.iter().all(|p| p.engine_progress.is_none() && p.profile_progress.is_some()));
    let last = progress[2].profile_progress.clone().unwrap();
    assert_eq!(last.recording, progress[0].profile_progress.clone().unwrap().recording);
    let structure = flatbuffers::root::<fb::QueryProfile>(&last.structure).unwrap();
    assert_eq!(structure.engine(), fb::ProfileEngine::TRINO);
    let sent = host.state.borrow().sent.clone();
    assert_eq!(sent[0].header("X-Trino-User"), Some("user"));
    assert!(sent[1].url.contains(&format!("targetResultSize={TARGET_RESULT_SIZE}")));
    assert!(host.log_messages().contains(&"Executing query".to_string()));
    assert!(host.log_messages().contains(&"Executed query".to_string()));
}

#[test]
fn trino_retries_a_busy_coordinator_after_a_delay() {
    let host = FakeHost::new();
    let busy = Answer::Now(Ok(HttpResponse::new(503, "")));
    trino_server(&host, vec![busy, trino_page(None, Some(json!([[1]])), "FINISHED")]);
    let executor = QueryExecutor::new(host.clone());
    let outcome = start(&host, &executor, request(1, QueryTarget::Trino(trino_channel())));
    host.advance(0);
    assert!(outcome.borrow().is_none());
    assert!(host.log_messages().contains(&"Retrying a request of query results".to_string()));
    host.advance(DEFAULT_TRINO_RETRY_POLICY.delay_ms(1));
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(true));
    assert_eq!(host.state.borrow().results.get(&1), Some(&1));
}

#[test]
fn trino_fails_with_the_error_of_the_query() {
    let host = FakeHost::new();
    let error = json!({ "id": "q1", "error": { "message": "line 1:8: Column 'x' cannot be resolved", "errorCode": 47, "errorName": "COLUMN_NOT_FOUND", "errorType": "USER_ERROR" } });
    trino_server(&host, vec![json_response(error)]);
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Trino(trino_channel()));
    query.throw_on_error = true;
    query.touches_relations = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.kind, FailureKind::Error);
    assert!(failure.details.contains(&("errorName".to_string(), "COLUMN_NOT_FOUND".to_string())));
    assert_eq!(host.events(), ["sending", "running", "progress:QUEUED", "failed:Query returned an error", "touch"]);
}

#[test]
fn trino_cancels_a_query_at_the_server() {
    let host = FakeHost::new();
    trino_server(&host, vec![]);
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Trino(trino_channel()));
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    assert!(outcome.borrow().is_none());
    run.token.cancel();
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    let sent = host.state.borrow().sent.clone();
    let delete = sent.last().unwrap();
    assert_eq!((delete.method.clone(), delete.url.clone()), (HttpMethod::Delete, next_uri(1)));
    assert_eq!(host.events().last().map(String::as_str), Some("cancelled"));
}

#[test]
fn trino_gives_up_a_cancellation_at_the_server_that_hangs() {
    let host = FakeHost::new();
    host.serve(|request| {
        if request.url.ends_with("/v1/statement") {
            return json_response(
                json!({ "id": "q1", "nextUri": next_uri(1), "stats": { "state": "QUEUED", "queued": true } }),
            );
        }
        // The network is gone: neither the next page nor the cancellation answers
        Answer::Hold
    });
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Trino(trino_channel()));
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    assert!(host.state.borrow().sent.iter().any(|r| r.method == HttpMethod::Delete), "the cancellation is sent");
    assert!(outcome.borrow().is_none(), "the query waits for the cancellation");
    let aborted = host.aborted.borrow().len();
    // The cancellation is given up and aborted, the query ends cancelled
    host.advance(BACKEND_CANCEL_TIMEOUT_MS as u64);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.events().last().map(String::as_str), Some("cancelled"));
    assert_eq!(host.aborted.borrow().get(aborted..), Some(&[next_uri(1)][..]), "the cancellation is aborted");
    assert!(
        host.log_messages().iter().any(|m| m == "Failed to cancel query at the backend"),
        "{:?}",
        host.log_messages()
    );
}

#[test]
fn trino_fetches_the_profile_while_a_view_shows_it() {
    let host = FakeHost::new();
    let stages = json!({ "state": "RUNNING", "rootStage": { "stageId": "0", "state": "RUNNING", "subStages": [] } });
    let mut pages: VecDeque<Answer> = VecDeque::new();
    pages.push_back(json_response(json!({ "id": "q1", "nextUri": next_uri(2), "stats": stages })));
    host.serve(move |request| {
        if request.url.contains("/v1/query/") {
            return json_response(json!({ "queryId": "q1", "state": "RUNNING" }));
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(json!({ "id": "q1", "nextUri": next_uri(1), "stats": { "state": "QUEUED" } }));
        }
        pages.pop_front().unwrap_or(Answer::Hold)
    });
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Trino(trino_channel()));
    let run = query.run.clone();
    let _outcome = start(&host, &executor, query);
    host.advance(0);
    let infos = || host.state.borrow().sent.iter().filter(|r| r.url.contains("/v1/query/")).count();
    assert_eq!(infos(), 0);
    run.controls.watch_profile(1);
    host.advance(0);
    assert_eq!(infos(), 1);
    run.controls.watch_profile(-1);
    host.advance(0);
    run.controls.watch_profile(0);
}

#[test]
fn a_view_of_the_profile_before_the_query_started_counts() {
    let host = FakeHost::new();
    let stages = json!({ "state": "RUNNING", "rootStage": { "stageId": "0", "state": "RUNNING", "subStages": [] } });
    host.serve(move |request| {
        if request.url.contains("/v1/query/") {
            return json_response(json!({ "queryId": "q1", "state": "RUNNING" }));
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(json!({ "id": "q1", "nextUri": next_uri(1), "stats": stages.clone() }));
        }
        Answer::Hold
    });
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Trino(trino_channel()));
    // The run keeps the controls from its registration on
    query.run.controls.watch_profile(1);
    let _outcome = start(&host, &executor, query);
    host.advance(0);
    assert_eq!(host.state.borrow().sent.iter().filter(|r| r.url.contains("/v1/query/")).count(), 1);
}

#[test]
fn trino_refreshes_an_expiring_token_once_for_all_queries_of_the_channel() {
    let host = FakeHost::new();
    let (token_sender, token_answer_later) = oneshot();
    let mut token_answer_later = Some(token_answer_later);
    let token_requests = Rc::new(Cell::new(0));
    let counted = token_requests.clone();
    host.serve(move |request| {
        if request.url == TOKEN_URL {
            counted.set(counted.get() + 1);
            return token_answer_later.take().map(Answer::Later).unwrap_or(Answer::Hold);
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(json!({ "id": "q1", "columns": [{ "name": "n", "type": "integer" }], "data": [[1]], "stats": { "state": "FINISHED" } }));
        }
        Answer::Hold
    });
    let executor = QueryExecutor::new(host.clone());
    // The token expires within the refresh margin, every query of the channel needs a fresh one
    let channel = oauth_trino_channel(ACCESS_TOKEN_REFRESH_MARGIN_MS / 2);
    let query = request(1, QueryTarget::Trino(channel.clone()));
    let first_run = query.run.clone();
    let first = start(&host, &executor, query);
    let second = start(&host, &executor, request(2, QueryTarget::Trino(channel.clone())));
    host.advance(0);
    assert_eq!(token_requests.get(), 1, "one refresh for both queries");
    // The query that started the refresh is cancelled, the refresh runs on for the other one
    first_run.token.cancel();
    host.advance(0);
    assert!(matches!(first.borrow().as_ref(), Some(QueryOutcome::Resolved { has_result: false })));
    assert!(second.borrow().is_none());
    token_sender.send(token_answer("token-2"));
    host.advance(0);
    assert_eq!(resolved(second.borrow().as_ref().unwrap()), Some(true));
    assert_eq!(token_requests.get(), 1);
    // The refresh sent the rotating refresh token once and the connection keeps the new token
    let sent = host.state.borrow().sent.clone();
    let refresh = sent.iter().find(|r| r.url == TOKEN_URL).unwrap();
    assert!(refresh.sensitive);
    assert!(refresh.body.as_deref().unwrap().contains("refresh_token=refresh-1"));
    let statements: Vec<_> = sent.iter().filter(|r| r.url.ends_with("/v1/statement")).collect();
    assert_eq!(statements.len(), 1);
    assert_eq!(statements[0].header("Authorization"), Some("Bearer token-2"));
    assert_eq!(host.state.borrow().refreshes, [(1, Ok(()))]);
    assert_eq!(channel.access_token().unwrap().access_token, "token-2");
    assert_eq!(channel.access_token().unwrap().refresh_token.as_deref(), Some("refresh-of-token-2"));
    // A later query of the channel needs no refresh
    let third = run(&host, &executor, request(3, QueryTarget::Trino(channel.clone())));
    assert_eq!(resolved(&third), Some(true));
    assert_eq!(token_requests.get(), 1);
}

#[test]
fn trino_fails_a_refresh_that_hangs_and_refreshes_again_later() {
    let host = FakeHost::new();
    let token_requests = Rc::new(Cell::new(0));
    let counted = token_requests.clone();
    host.serve(move |request| {
        if request.url == TOKEN_URL {
            counted.set(counted.get() + 1);
            // The first refresh never answers, the second one does
            return if counted.get() == 1 { Answer::Hold } else { Answer::Now(Ok(token_answer("token-2"))) };
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(json!({ "id": "q1", "columns": [{ "name": "n", "type": "integer" }], "data": [[1]], "stats": { "state": "FINISHED" } }));
        }
        Answer::Hold
    });
    let executor = QueryExecutor::new(host.clone());
    let channel = oauth_trino_channel(ACCESS_TOKEN_REFRESH_MARGIN_MS / 2);
    let first = start(&host, &executor, request(1, QueryTarget::Trino(channel.clone())));
    host.advance(0);
    assert!(first.borrow().is_none(), "the query waits for the refresh");
    // The refresh times out: the query fails, the host hears of the failure and the channel refreshes no more
    host.advance(TRINO_TOKEN_REFRESH_TIMEOUT_MS as u64);
    assert_eq!(first.borrow().as_ref().map(resolved), Some(Some(false)), "the query failed without a result");
    let refreshes = host.state.borrow().refreshes.clone();
    let [(1, Err(error))] = refreshes.as_slice() else { panic!("{refreshes:?}") };
    assert!(error.message.contains("timed out"), "{}", error.message);
    // The next query starts a new refresh
    let second = run(&host, &executor, request(2, QueryTarget::Trino(channel.clone())));
    assert_eq!(resolved(&second), Some(true));
    assert_eq!(token_requests.get(), 2);
    assert_eq!(host.state.borrow().refreshes.last(), Some(&(2, Ok(()))));
    assert_eq!(channel.access_token().unwrap().access_token, "token-2");
}

#[test]
fn trino_cancels_the_query_at_the_server_during_a_token_refresh() {
    let host = FakeHost::new();
    let mut busy = true;
    host.serve(move |request| {
        if request.method == HttpMethod::Delete {
            return Answer::Now(Ok(HttpResponse::new(204, "")));
        }
        if request.url == TOKEN_URL {
            return Answer::Hold;
        }
        if request.url.ends_with("/v1/statement") {
            return json_response(
                json!({ "id": "q1", "nextUri": next_uri(1), "stats": { "state": "QUEUED", "queued": true } }),
            );
        }
        // The first page is retried after a delay
        if std::mem::take(&mut busy) {
            return Answer::Now(Ok(HttpResponse::new(503, "")));
        }
        Answer::Hold
    });
    let executor = QueryExecutor::new(host.clone());
    // The token is fresh for the statement and the first page, the retry of the page needs a refresh
    let channel = oauth_trino_channel(ACCESS_TOKEN_REFRESH_MARGIN_MS + 50);
    let query = request(1, QueryTarget::Trino(channel));
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    assert!(!host.state.borrow().sent.iter().any(|r| r.url == TOKEN_URL));
    host.advance(DEFAULT_TRINO_RETRY_POLICY.delay_ms(1));
    assert!(host.state.borrow().sent.iter().any(|r| r.url == TOKEN_URL), "the next page waits for a refresh");
    run.token.cancel();
    host.advance(0);
    assert!(outcome.borrow().is_some());
    let sent = host.state.borrow().sent.clone();
    let delete = sent.last().unwrap();
    assert_eq!((delete.method.clone(), delete.url.clone()), (HttpMethod::Delete, next_uri(1)));
}

#[test]
fn trino_cancels_a_query_at_the_server_that_failed_in_the_protocol() {
    let host = FakeHost::new();
    // A page with rows but without columns breaks the protocol while Trino still runs the query
    trino_server(
        &host,
        vec![json_response(
            json!({ "id": "q1", "nextUri": next_uri(2), "data": [[1]], "stats": { "state": "RUNNING" } }),
        )],
    );
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Trino(trino_channel()));
    query.throw_on_error = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.message, "Result schema is missing");
    let sent = host.state.borrow().sent.clone();
    let delete = sent.iter().find(|r| r.method == HttpMethod::Delete).expect("a cancellation");
    assert_eq!(delete.url, next_uri(2));
    // The page that was requested before the failure is aborted
    assert!(host.aborted.borrow().iter().any(|url| url.starts_with(&next_uri(2))));
}

#[test]
fn cancelling_a_query_aborts_the_requests_that_it_waits_for() {
    let host = FakeHost::new();
    trino_server(&host, vec![]);
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Trino(trino_channel()));
    let run = query.run.clone();
    let _outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    let aborted = host.aborted.borrow();
    assert_eq!(aborted.len(), 1);
    assert!(aborted[0].starts_with(&next_uri(1)), "{aborted:?}");
}

// Hyper

#[test]
fn hyper_reads_the_result_of_a_query_over_http() {
    let host = FakeHost::new();
    host.serve(move |request| {
        assert_eq!(request.url, format!("{HYPER}/api/v3/query"));
        assert_eq!(request.header("authorization"), Some("Bearer token"));
        let status = json!({ "queryId": "h1", "completionStatus": "RESULTS_PRODUCED", "chunkCount": 1, "rowCount": 3 });
        Answer::Now(Ok(
            HttpResponse::new(200, batch_ipc(&[1, 2, 3])).with_header("x-hyperdb-status", &status.to_string())
        ))
    });
    let channel = HyperHttpChannel::connect(
        json!({ "endpoint": HYPER }).as_object().unwrap(),
        HyperChannelContext::default(),
        None,
    )
    .unwrap();
    let auth = Headers::from_pairs([("Authorization", "Bearer token")]);
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth }));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.events(), ["sending", "running", "progress:", "batch:0", "all:3", "succeeded"]);
    // The status of the query is the progress of the whole query
    let progress = host.state.borrow().progress.clone();
    let profile = progress[0].profile_progress.clone().unwrap();
    let query = profile.execution.query.unwrap();
    assert_eq!(query.stats.tuples_out, Some(3));
    let structure = flatbuffers::root::<fb::QueryProfile>(&profile.structure).unwrap();
    assert_eq!(structure.engine(), fb::ProfileEngine::HYPER);
}

#[test]
fn hyper_passes_the_chunks_to_the_host_unread() {
    let host = FakeHost::new();
    host.state.borrow_mut().keep_bodies = true;
    host.serve(move |request| {
        let status = json!({ "queryId": "h1", "completionStatus": "RESULTS_PRODUCED", "chunkCount": 1, "rowCount": 3 });
        assert_eq!(request.method, HttpMethod::Post);
        Answer::Now(Ok(
            HttpResponse::new(200, batch_ipc(&[1, 2, 3])).with_header("x-hyperdb-status", &status.to_string())
        ))
    });
    let channel = HyperHttpChannel::connect(
        json!({ "endpoint": HYPER }).as_object().unwrap(),
        HyperChannelContext::default(),
        None,
    )
    .unwrap();
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth: Headers::new() }));
    assert_eq!(resolved(&outcome), Some(true));
    // The chunk stayed with the host, the host built the table
    assert_eq!(host.state.borrow().host_parts, 1);
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
}

#[test]
fn the_progress_of_a_channel_of_the_host_goes_into_the_progress_model_with_the_layout_of_the_executor() {
    let host = FakeHost::new();
    let status = |progress: f64| HyperQueryStatus {
        completion_status: "RUNNING_OR_UNSPECIFIED".into(),
        row_count: None,
        progress: Some(progress),
        execution_stats: None,
    };
    {
        let mut state = host.state.borrow_mut();
        for (at, fraction) in [(1, 0.25), (2, 0.5)] {
            let progress = QueryExecutionProgress {
                engine_progress: Some(EngineProgressPayload::HyperQueryStatus {
                    status: status(fraction),
                    received_at: at,
                }),
                ..Default::default()
            };
            state.channel.push_back(Ok(ChannelMessage::Progress(Box::new(progress))));
        }
        // A plain update keeps no structured progress of its own, the history keeps the earlier one
        state.channel.push_back(Ok(ChannelMessage::Progress(Box::default())));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(0) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let top_down = fb::ProfileLayoutOrientation::TOP_DOWN;
    executor.set_progress_layout(Some(progress_layout(top_down)));
    let outcome = run(&host, &executor, request(1, QueryTarget::Host));
    assert_eq!(resolved(&outcome), Some(true));
    let progress = host.state.borrow().progress.clone();
    assert_eq!(progress.len(), 3);
    let work = |p: &QueryExecutionProgress| {
        let stats = p.profile_progress.as_ref()?.execution.query?.stats;
        Some((stats.work_done?, stats.work_total?))
    };
    assert_eq!(work(&progress[0]), Some((250, 1000)));
    assert_eq!(work(&progress[1]), Some((500, 1000)));
    assert!(progress[2].profile_progress.is_none());
    let profile = progress[1].profile_progress.clone().unwrap();
    let structure = flatbuffers::root::<fb::QueryProfile>(&profile.structure).unwrap();
    assert_eq!(structure.layout_config().unwrap().input().orientation(), top_down);
}

#[test]
fn hyper_asks_for_the_auth_headers_again_and_cancels_a_result_that_breaks_off() {
    let host = FakeHost::new();
    host.serve(move |request| {
        if request.method == HttpMethod::Delete {
            return Answer::Now(Ok(HttpResponse::new(200, "")));
        }
        if request.url.contains("/chunk/") {
            return Answer::Now(Err(HostError::new("connection reset")));
        }
        let status = json!({ "queryId": "h1", "completionStatus": "RESULTS_PRODUCED", "chunkCount": 2, "rowCount": 6 });
        Answer::Now(Ok(
            HttpResponse::new(200, batch_ipc(&[1, 2, 3])).with_header("x-hyperdb-status", &status.to_string())
        ))
    });
    // The token of the channel changed after the query started
    host.state.borrow_mut().hyper_auth = Some(Headers::from_pairs([("Authorization", "Bearer token-2")]));
    let channel = HyperHttpChannel::connect(
        json!({ "endpoint": HYPER }).as_object().unwrap(),
        HyperChannelContext::default(),
        None,
    )
    .unwrap();
    let auth = Headers::from_pairs([("Authorization", "Bearer token-1")]);
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth }));
    assert_eq!(resolved(&outcome), Some(false));
    let sent = host.state.borrow().sent.clone();
    assert_eq!(sent[0].header("authorization"), Some("Bearer token-1"));
    let chunk = sent.iter().find(|r| r.url.contains("/chunk/")).expect("a chunk request");
    assert_eq!(chunk.header("authorization"), Some("Bearer token-2"));
    // The result broke off in the network while Hyper may still run the query, it is cancelled there
    let cancel = sent.iter().find(|r| r.method == HttpMethod::Delete).expect("a cancellation");
    assert_eq!(cancel.url, format!("{HYPER}/api/v3/query/h1"));
    assert_eq!(cancel.header("authorization"), Some("Bearer token-2"));
}

#[test]
fn hyper_fails_with_the_error_of_the_server() {
    let host = FakeHost::new();
    host.serve(|_| {
        let body = json!({ "code": 3, "message": "syntax error at end of input" });
        Answer::Now(Ok(HttpResponse::new(400, body.to_string()).with_header("Content-Type", "application/json")))
    });
    let channel = HyperHttpChannel::connect(
        json!({ "endpoint": HYPER }).as_object().unwrap(),
        HyperChannelContext::default(),
        None,
    )
    .unwrap();
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth: Headers::new() }));
    assert_eq!(resolved(&outcome), Some(false));
    let events = host.events();
    assert!(events.last().unwrap().starts_with("failed:"), "{events:?}");
}

// Channels of the host

/// The layout of the progress of the app with an orientation, only the orientation matters to the tests
fn progress_layout(orientation: fb::ProfileLayoutOrientation) -> fb::ProfileLayoutConfig {
    fb::ProfileLayoutConfig::new(56.0, 32.0, 28.0, 12.0, 12.0, 34.0, 8.0, 20, 8.5, 0.0, 40.0, orientation, 20.0)
}

fn metrics(rows: u64) -> QueryExecutionMetrics {
    QueryExecutionMetrics { total_rows_received: rows, total_batches_received: 1, ..QueryExecutionMetrics::default() }
}

#[test]
fn a_channel_of_the_host_keeps_its_batches() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        let progress = QueryExecutionProgress { phase: Some("host".into()), ..Default::default() };
        state.channel.push_back(Ok(ChannelMessage::Progress(Box::new(progress))));
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(2) }));
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(3) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(3) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.touches_relations = true;
    let outcome = run(&host, &executor, query);
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(
        host.events(),
        ["sending", "running", "progress:host", "batch:2", "batch:3", "all:3", "touch", "succeeded"]
    );
    assert_eq!(host.state.borrow().channel_calls, ["open"]);
    // Nothing of the result crossed
    assert_eq!(part_count(&host, 1), 0);
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
}

#[test]
fn a_statement_without_published_results_is_drained() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.publish_results = false;
    assert_eq!(resolved(&run(&host, &executor, query)), Some(false));
    assert_eq!(host.events(), ["sending", "running", "succeeded"]);
}

#[test]
fn a_channel_without_a_result_succeeds_without_a_table() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_stream = false;
    let executor = QueryExecutor::new(host.clone());
    assert_eq!(resolved(&run(&host, &executor, request(1, QueryTarget::Host))), Some(false));
    assert_eq!(host.events(), ["sending", "succeeded"]);
    assert!(host.log_messages().contains(&"Query returned no results".to_string()));
}

#[test]
fn a_channel_is_cancelled_at_the_backend() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_cancel_fails = true;
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Host);
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    // A view of the profile doesn't reach the channel
    run.controls.watch_profile(1);
    host.advance(0);
    run.controls.watch_profile(-1);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.state.borrow().channel_calls, ["open", "cancel"]);
    assert!(host.log_messages().contains(&"Failed to cancel query at the backend".to_string()));
    assert_eq!(host.events(), ["sending", "running", "cancelled"]);
}

#[test]
fn a_cancelled_query_does_not_reach_the_backend() {
    let host = FakeHost::new();
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Host);
    query.run.token.cancel();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    assert!(
        matches!(outcome.borrow().as_ref(), Some(QueryOutcome::Rejected(failure)) if failure.kind == FailureKind::Cancelled)
    );
    assert!(host.state.borrow().channel_calls.is_empty());
    assert_eq!(host.events(), ["cancelled"]);
}

#[test]
fn a_cancel_while_the_channel_opens_the_query_stops_it_there() {
    // The embedded Hyper runs one query at a time, a query waits in the channel for the one before it
    let host = FakeHost::new();
    host.state.borrow_mut().open_holds = true;
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.touches_relations = true;
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    assert!(outcome.borrow().is_none());
    // The token is the one cancellation: the task tells the channel, the open fails and the query ends at once
    run.token.cancel();
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.state.borrow().channel_calls, ["open", "cancel"]);
    assert_eq!(host.events(), ["sending", "cancelled", "touch"]);
}

#[test]
fn a_stream_that_the_channel_opens_after_a_cancel_is_cancelled() {
    let host = FakeHost::new();
    let (answer, open) = oneshot();
    host.state.borrow_mut().open_later = Some(open);
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Host);
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    // The channel ignored the cancel of the open and returns a stream, the stream is cancelled
    assert!(outcome.borrow().is_none());
    answer.send(true);
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.state.borrow().channel_calls, ["open", "cancel", "cancel"]);
    assert_eq!(host.events(), ["sending", "cancelled"]);
}

#[test]
fn a_cancel_that_races_the_end_of_a_query_ends_it_once() {
    let host = FakeHost::new();
    let (answer, open) = oneshot();
    {
        let mut state = host.state.borrow_mut();
        state.open_later = Some(open);
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.throw_on_error = true;
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    // The stream and the cancel arrive in the same turn, the cancel wins
    answer.send(true);
    run.token.cancel();
    host.advance(0);
    assert!(
        matches!(outcome.borrow().as_ref(), Some(QueryOutcome::Rejected(failure)) if failure.kind == FailureKind::Cancelled)
    );
    let events = host.events();
    let ends = events.iter().filter(|e| *e == "succeeded" || *e == "cancelled" || e.starts_with("failed:")).count();
    assert_eq!(ends, 1, "{events:?}");
    assert_eq!(events.last().map(String::as_str), Some("cancelled"));

    // A cancel after the end changes nothing
    let host = FakeHost::new();
    host.state.borrow_mut().channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    let executor = QueryExecutor::new(host.clone());
    let query = request(1, QueryTarget::Host);
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(true));
    assert_eq!(host.events().last().map(String::as_str), Some("succeeded"));
    assert!(!host.state.borrow().channel_calls.contains(&"cancel".to_string()));
}

#[test]
fn a_query_succeeds_before_the_analysis_of_its_result() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.analysis_holds = true;
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.analyze_results = true;
    query.result = stored("k");
    let outcome = run(&host, &executor, query);
    // The analysis started before the query succeeded and still runs, the result is stored
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.events(), ["sending", "running", "batch:1", "all:1", "succeeded", "cache:false"]);
    assert_eq!(*host.analyses.borrow(), ["start"]);
    assert_eq!(host.state.borrow().cache_calls, ["write:a.sql:k"]);
}

#[test]
fn a_failed_analysis_leaves_the_query_and_its_result_alone() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.analysis_fails = true;
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.analyze_results = true;
    query.result = stored("k");
    let outcome = run(&host, &executor, query);
    host.advance(0);
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.events(), ["sending", "running", "batch:1", "all:1", "succeeded", "cache:false"]);
    assert_eq!(*host.analyses.borrow(), ["start", "end:failed"]);
    assert_eq!(host.state.borrow().cache_calls, ["write:a.sql:k"]);
}

#[test]
fn a_cancel_after_the_query_stops_the_analysis_of_its_result() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.analysis_holds = true;
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.analyze_results = true;
    let run_of_query = query.run.clone();
    let outcome = run(&host, &executor, query);
    assert_eq!(resolved(&outcome), Some(true));
    run_of_query.token.cancel();
    host.advance(0);
    // The query stays succeeded
    assert_eq!(host.events().last().map(String::as_str), Some("succeeded"));
    assert_eq!(*host.analyses.borrow(), ["start", "end:cancelled"]);
}

#[test]
fn a_query_without_a_result_is_not_analyzed() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_stream = false;
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.analyze_results = true;
    let outcome = run(&host, &executor, query);
    assert_eq!(resolved(&outcome), Some(false));
    assert!(host.analyses.borrow().is_empty());
}

// The stored results of the scripts

/// A query that stores its result as the result of `a.sql` under a key
fn stored(key: &str) -> Option<ResultRequest> {
    let name = format!("a.{key}.parquet");
    Some(ResultRequest { workbook_id: "w".into(), script: "a.sql".into(), key: key.into(), name, read: None })
}

/// A query that reads a file of the results of `w`
fn reads(name: &str) -> Option<ResultRequest> {
    let file = StoredFile { name: name.into(), key: "k".into(), written_at: 1234.0 };
    Some(ResultRequest {
        workbook_id: "w".into(),
        script: "a.sql".into(),
        key: "k".into(),
        name: name.into(),
        read: Some(file),
    })
}

#[test]
fn a_stored_result_is_read_without_the_backend() {
    let host = FakeHost::new();
    host.state.borrow_mut().files.insert("a.parquet".into(), ());
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.result = reads("a.parquet");
    query.touches_relations = true;
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    // A read touches no relations and writes nothing
    assert_eq!(host.events(), ["all:1", "cache:true", "succeeded"]);
    assert_eq!(host.state.borrow().cache_calls, ["read:a.parquet"]);
    assert!(host.state.borrow().channel_calls.is_empty());
}

#[test]
fn a_query_stores_its_result_as_the_file_of_its_script() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.result = stored("k");
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    host.advance(0);
    assert_eq!(host.state.borrow().cache_calls, ["write:a.sql:k"]);
    assert_eq!(host.events().last().map(String::as_str), Some("cache:false"));
    let flushed = Rc::new(Cell::new(false));
    let flag = flushed.clone();
    let flush = executor.flush_result_writes();
    host.executor.spawn(Box::pin(async move {
        flush.await;
        flag.set(true);
    }));
    host.advance(0);
    assert!(flushed.get());
}

#[test]
fn a_query_without_a_result_removes_the_files_of_its_script() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_stream = false;
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.result = stored("k");
    assert_eq!(resolved(&run(&host, &executor, query)), Some(false));
    host.advance(0);
    assert_eq!(host.state.borrow().cache_calls, ["clear:a.sql"]);
}

#[test]
fn a_failed_write_only_logs() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.cache_write_fails = true;
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.result = stored("k");
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    host.advance(0);
    assert!(host.log_messages().contains(&"Failed to store the result of a script".to_string()));
    assert_eq!(host.events().last().map(String::as_str), Some("succeeded"));
}

#[test]
fn a_read_of_a_file_that_is_gone_or_broken_fails_with_a_miss() {
    for broken in [false, true] {
        let host = FakeHost::new();
        host.state.borrow_mut().cache_read_fails = broken;
        let executor = QueryExecutor::new(host.clone());
        let mut query = request(1, QueryTarget::Host);
        query.result = reads("a.parquet");
        query.throw_on_error = true;
        query.touches_relations = true;
        let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
        assert_eq!(failure.kind, FailureKind::CacheMiss);
        // Nothing ran, nothing touched the relations
        assert!(host.state.borrow().channel_calls.is_empty());
        assert_eq!(host.events().len(), 1);
        assert!(host.events()[0].starts_with("failed:The stored result"), "{:?}", host.events());
    }
}

#[test]
fn a_cancel_during_the_read_of_a_stored_result_waits_for_the_table_of_the_run() {
    let host = FakeHost::new();
    let (read_done, read) = oneshot();
    {
        let mut state = host.state.borrow_mut();
        state.files.insert("a.parquet".into(), ());
        state.cache_read_later = Some(read);
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.result = reads("a.parquet");
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    // The read runs to its end, the run owns the table that it read
    assert!(outcome.borrow().is_none());
    read_done.send(());
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(*host.cache_tables.borrow(), [1]);
    assert_eq!(host.events(), ["cancelled"]);
    assert_eq!(host.state.borrow().cache_calls, ["read:a.parquet"]);
}

// Client functions

/// The channel of a Salesforce connection with the tokens
fn salesforce_channel() -> dashql_core_runtime::connections::ConnectionChannel {
    let params = dashql_core_runtime::salesforce::SalesforceConnectionParams::default();
    let channel = dashql_core_runtime::salesforce::SharedSalesforceChannel::new(
        ConnectorType::SalesforceDataCloud,
        &params,
        salesforce_tokens(),
    );
    dashql_core_runtime::connections::ConnectionChannel::Salesforce(channel.unwrap())
}

fn salesforce_tokens() -> SalesforceTokens {
    SalesforceTokens {
        core: serde_json::from_value(
            json!({ "accessToken": "core-token", "instanceUrl": "https://org.my.salesforce.com" }),
        )
        .unwrap(),
        data_cloud: serde_json::from_value(
            json!({ "instanceUrl": "https://tenant.c360a.salesforce.com/", "jwt": { "raw": "tenant-jwt" } }),
        )
        .unwrap(),
    }
}

fn segment_spec() -> Rc<ClientFunctionSpec> {
    let spec = json!({
        "format": 1,
        "namespace": "d360",
        "hosts": { "core": { "base_path": "/services/data/v{api_version}" } },
        "functions": [{ "name": "segment_list", "method": "GET", "host": "core", "path": "/ssot/segments", "rows": "/segments" }],
    });
    Rc::new(ClientFunctionSpec::from_value(spec).unwrap())
}

fn segment_call() -> ClientFunctionCallDescription {
    ClientFunctionCallDescription {
        namespace: "d360".into(),
        function: "segment_list".into(),
        ..ClientFunctionCallDescription::default()
    }
}

#[test]
fn a_client_function_call_asks_the_service() {
    let host = FakeHost::new();
    host.serve(|request| {
        assert_eq!(
            request.url,
            format!("https://org.my.salesforce.com/services/data/v{DATA_360_API_VERSION}/ssot/segments")
        );
        assert_eq!(request.header("Authorization"), Some("Bearer core-token"));
        json_response(json!({ "segments": [{ "apiName": "Vip" }, { "apiName": "New" }] }))
    });
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: segment_spec(),
        description: segment_call(),
        channel: Some(salesforce_channel()),
    };
    let outcome = run(&host, &executor, request(1, QueryTarget::ClientFunction(target)));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.state.borrow().results.get(&1), Some(&2));
}

#[test]
fn a_client_function_call_hands_over_a_page_at_a_time() {
    let host = FakeHost::new();
    let mut pages = VecDeque::from([
        json!({ "segments": [{ "apiName": "A" }, { "apiName": "B" }], "nextPageToken": "t1" }),
        json!({ "segments": [{ "apiName": "C" }], "nextPageToken": "t2" }),
    ]);
    host.serve(move |_| json_response(pages.pop_front().unwrap_or(json!({ "segments": [] }))));
    let spec = json!({
        "format": 1,
        "namespace": "d360",
        "hosts": { "core": { "base_path": "/services/data/v{api_version}" } },
        "functions": [{
            "name": "segment_list", "method": "GET", "host": "core", "path": "/ssot/segments", "rows": "/segments",
            "options": [{ "name": "page_token", "api_name": "pageToken", "in": "query" }],
            "paging": { "kind": "token", "from": { "body": "/nextPageToken" }, "option": "page_token" },
        }],
    });
    let mut description = segment_call();
    description.options = json!({ "_pages": 2 }).as_object().cloned().unwrap();
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: Rc::new(ClientFunctionSpec::from_value(spec).unwrap()),
        description,
        channel: Some(salesforce_channel()),
    };
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::ClientFunction(target)));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
    // A batch per page
    assert_eq!(host.events().iter().filter(|event| event.starts_with("batch:")).count(), 2);
}

#[test]
fn a_client_function_call_fails_with_the_service() {
    let host = FakeHost::new();
    host.serve(|_| Answer::Now(Ok(HttpResponse::new(403, json!([{ "message": "No access" }]).to_string()))));
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: segment_spec(),
        description: segment_call(),
        channel: Some(salesforce_channel()),
    };
    let mut query = request(1, QueryTarget::ClientFunction(target));
    query.throw_on_error = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.details, [("status".to_string(), "403".to_string())]);
}

#[test]
fn a_client_function_call_stops_its_request_when_cancelled() {
    let host = FakeHost::new();
    host.serve(|_| Answer::Hold);
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: segment_spec(),
        description: segment_call(),
        channel: Some(salesforce_channel()),
    };
    let query = request(1, QueryTarget::ClientFunction(target));
    let run = query.run.clone();
    let outcome = start(&host, &executor, query);
    host.advance(0);
    run.token.cancel();
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.events(), ["sending", "cancelled"]);
}
