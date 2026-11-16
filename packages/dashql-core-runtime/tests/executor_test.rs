// The query executor on a fake host: an executor of a single thread, a clock that only the test advances, an HTTP
// server of answers and a channel of the host. The semantics follow
// packages/dashql/src/runtime/connections/query_executor_service.test.ts.

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

use dashql_core_runtime::clfn::{ClientFunctionCallDescription, ClientFunctionSpec};
use dashql_core_runtime::connections::{ConnectorType, TrinoSessionDefaults};
use dashql_core_runtime::executor::ipc::{read_stream, write_stream};
use dashql_core_runtime::executor::{
    CacheEntry, CacheRequest, ChannelMessage, ClientFunctionTarget, ExecutorHost, FailureKind, HostTable, QueryEvent,
    QueryExecutor, QueryFailure, QueryId, QueryOutcome, QueryRequest, QueryTarget,
};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{
    Body, CancellationToken, Headers, HostBytes, HttpHost, HttpMethod, HttpRequest, HttpResponse,
};
use dashql_core_runtime::hyper::{HyperChannelContext, HyperHttpChannel};
use dashql_buffers::profile as fb;
use dashql_core_runtime::query::progress::{EngineProgressPayload, HyperQueryStatus};
use dashql_core_runtime::query::{QueryExecutionMetrics, QueryExecutionProgress};
use dashql_core_runtime::salesforce::SalesforceTokens;
use dashql_core_runtime::trino::{TrinoAuthParams, TrinoAuthType, TrinoChannel};

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
}

type Server = Box<dyn FnMut(&HttpRequest) -> Answer>;

#[derive(Default)]
struct State {
    /// The events of the queries without the logs
    events: Vec<String>,
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
    cache: HashMap<String, CacheEntry>,
    cache_calls: Vec<String>,
    /// Cancelled with the query of the channel, a stream that waits for a message then fails
    channel_aborted: CancellationToken,
    cache_read_fails: bool,
    cache_write_fails: bool,
    analysis_fails: bool,
}

struct FakeHost {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
    state: RefCell<State>,
    server: RefCell<Option<Server>>,
}

impl FakeHost {
    fn new() -> Rc<Self> {
        Rc::new(Self {
            executor: Rc::default(),
            clock: Rc::default(),
            state: RefCell::new(State { channel_stream: true, ..State::default() }),
            server: RefCell::new(None),
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
}

impl HttpHost for FakeHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.state.borrow_mut().sent.push(request.clone());
        let answer = match self.server.borrow_mut().as_mut() {
            Some(server) => server(&request),
            None => Answer::Now(Err(HostError::new("no server"))),
        };
        let future: Boxed<Result<HttpResponse, HostError>> = match answer {
            Answer::Now(result) => Box::pin(std::future::ready(result)),
            Answer::Hold => aborted(cancellation),
        };
        future
    }
}

fn event_name(event: &QueryEvent) -> Option<String> {
    Some(match event {
        QueryEvent::Sending => "sending".into(),
        QueryEvent::Running => "running".into(),
        QueryEvent::Progress(progress) => format!("progress:{}", progress.phase.clone().unwrap_or_default()),
        QueryEvent::ResultData(_) => return None,
        QueryEvent::ReceivedBatch(metrics) => format!("batch:{}", metrics.total_rows_received),
        QueryEvent::ReceivedAllBatches { rows, .. } => format!("all:{rows}"),
        QueryEvent::ProcessingResults => "processing".into(),
        QueryEvent::ProcessedResults => "processed".into(),
        QueryEvent::Succeeded => "succeeded".into(),
        QueryEvent::Failed { failure, .. } => format!("failed:{}", failure.message),
        QueryEvent::Cancelled { .. } => "cancelled".into(),
        QueryEvent::CacheRecorded { key, served_from_cache, .. } => format!("cache:{key}:{served_from_cache}"),
        QueryEvent::TouchRelations => "touch".into(),
        QueryEvent::Timing { label, .. } => format!("timing:{label}"),
        QueryEvent::ResultsReady => "ready".into(),
        QueryEvent::TrinoTokenRefreshed(_) => "token".into(),
        QueryEvent::Log { .. } => return None,
    })
}

impl ExecutorHost for FakeHost {
    fn report(&self, query_id: QueryId, event: QueryEvent) {
        let mut state = self.state.borrow_mut();
        if let QueryEvent::Log { level, message, details, .. } = &event {
            state.logs.push((*level, message.clone(), details.clone()));
            return;
        }
        match &event {
            // The parts of the result stay with the host
            QueryEvent::ResultData(Body::Bytes(bytes)) => state.parts.entry(query_id).or_default().push(bytes.clone()),
            QueryEvent::ResultData(Body::Host(bytes)) => {
                let kept = bytes.value().downcast_ref::<Vec<u8>>().expect("bytes of the host").clone();
                state.host_parts += 1;
                state.parts.entry(query_id).or_default().push(kept);
            }
            QueryEvent::ReceivedAllBatches { rows, .. } => {
                state.results.insert(query_id, *rows as usize);
            }
            QueryEvent::Progress(progress) => state.progress.push((**progress).clone()),
            _ => {}
        }
        if let Some(name) = event_name(&event) {
            state.events.push(name);
        }
    }

    fn cache_lookup(&self, _query_id: QueryId, key: &str) -> impl Future<Output = Result<Option<CacheEntry>, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.cache_calls.push(format!("lookup:{key}"));
        std::future::ready(Ok(state.cache.get(key).cloned()))
    }

    fn cache_read(&self, _query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.cache_calls.push(format!("read:{}", entry.name));
        let fails = state.cache_read_fails;
        std::future::ready(if fails { Err(HostError::new("corrupt parquet")) } else { Ok(HostTable { rows: 1, columns: 1, batches: 1 }) })
    }

    fn cache_touch(&self, _query_id: QueryId, entry: &CacheEntry) -> impl Future<Output = Result<(), HostError>> + 'static {
        self.state.borrow_mut().cache_calls.push(format!("touch:{}", entry.name));
        std::future::ready(Err(HostError::new("read only")))
    }

    fn cache_write(&self, _query_id: QueryId, key: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.cache_calls.push(format!("write:{key}"));
        let fails = state.cache_write_fails;
        std::future::ready(if fails { Err(HostError::new("quota exceeded")) } else { Ok(()) })
    }

    fn analyze_result(&self, _query_id: QueryId, _cancellation: &CancellationToken) -> impl Future<Output = Result<(), HostError>> + 'static {
        let fails = self.state.borrow().analysis_fails;
        std::future::ready(if fails { Err(HostError::new("no compute")) } else { Ok(()) })
    }

    fn fetch_result(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
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

    fn finish_result(&self, query_id: QueryId) -> impl Future<Output = Result<HostTable, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        // The host builds the table from the parts of the stream, or from the batches of its channel
        let table = match state.parts.remove(&query_id) {
            Some(parts) => read_stream(&parts.concat()).map_err(HostError::new).map(|(schema, batches)| HostTable {
                rows: batches.iter().map(|batch| batch.num_rows() as u64).sum(),
                columns: schema.fields().len() as u64,
                batches: batches.len() as u64,
            }),
            None => Ok(HostTable { rows: state.channel_rows, columns: 1, batches: 1 }),
        };
        std::future::ready(table)
    }

    fn channel_open(&self, _query_id: QueryId) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.channel_calls.push("open".into());
        std::future::ready(Ok(state.channel_stream))
    }

    fn channel_next(&self, _query_id: QueryId) -> impl Future<Output = Result<ChannelMessage, HostError>> + 'static {
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

    fn channel_cancel(&self, _query_id: QueryId) -> impl Future<Output = Result<(), HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.channel_calls.push("cancel".into());
        state.channel_aborted.cancel();
        let fails = state.channel_cancel_fails;
        std::future::ready(if fails { Err(HostError::new("backend gone")) } else { Ok(()) })
    }

    fn channel_profile_detail(&self, _query_id: QueryId, wanted: bool) {
        self.state.borrow_mut().channel_calls.push(format!("profile:{wanted}"));
    }
}

// Helpers

fn request(query_id: QueryId, target: QueryTarget) -> QueryRequest {
    QueryRequest {
        query_id,
        connection_id: "c".into(),
        text: "select 1".into(),
        target,
        publish_results: true,
        analyze_results: false,
        cache: None,
        cache_only: false,
        touches_relations: false,
        throw_on_error: false,
        failure: None,
        log_details: vec![("workbookId".into(), "w".into())],
        keep_alive: None,
    }
}

/// Start a query, the outcome arrives in the cell
fn start(host: &Rc<FakeHost>, executor: &QueryExecutor<FakeHost>, request: QueryRequest) -> Rc<RefCell<Option<QueryOutcome>>> {
    let outcome = Rc::new(RefCell::new(None));
    let slot = outcome.clone();
    let future = executor.execute(request, CancellationToken::new());
    host.executor.spawn(Box::pin(async move {
        *slot.borrow_mut() = Some(future.await);
    }));
    outcome
}

fn run(host: &Rc<FakeHost>, executor: &QueryExecutor<FakeHost>, request: QueryRequest) -> QueryOutcome {
    let outcome = start(host, executor, request);
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

fn trino_channel() -> TrinoChannel {
    let auth = TrinoAuthParams { auth_type: TrinoAuthType::Basic, username: "user".into(), secret: "secret".into(), oauth: None };
    TrinoChannel::new(TRINO, auth, TrinoSessionDefaults::default())
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
            return json_response(json!({ "id": "q1", "nextUri": next_uri(1), "stats": { "state": "QUEUED", "queued": true } }));
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
    trino_server(&host, vec![trino_page(Some(2), Some(json!([[1], [2]])), "RUNNING"), trino_page(None, Some(json!([[3]])), "FINISHED")]);
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::Trino(trino_channel())));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(
        host.events(),
        [
            "sending", "running", "progress:QUEUED", "progress:RUNNING", "batch:2", "progress:FINISHED", "batch:3",
            "timing:Results", "all:3", "ready", "succeeded"
        ]
    );
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
    // The statement stats go into the progress model of the query, every update carries its structured progress
    let progress = host.state.borrow().progress.clone();
    assert_eq!(progress.len(), 3);
    assert!(progress.iter().all(|p| p.engine_progress.is_none() && p.profile_progress.is_some()));
    let last = progress[2].profile_progress.clone().unwrap();
    assert_eq!(last.recording, progress[0].profile_progress.clone().unwrap().recording);
    assert_eq!(last.recording.len(), 3);
    let structure = flatbuffers::root::<fb::QueryProfile>(&last.structure).unwrap();
    assert_eq!(structure.engine(), fb::ProfileEngine::TRINO);
    let sent = host.state.borrow().sent.clone();
    assert_eq!(sent[0].header("X-Trino-User"), Some("user"));
    assert!(sent[1].url.contains("targetResultSize=32MB"));
    assert!(host.log_messages().contains(&"Executing query".to_string()));
    assert!(host.log_messages().contains(&"Executed query".to_string()));
    assert!(!executor.is_running(1));
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
    host.advance(100);
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
    let outcome = start(&host, &executor, request(1, QueryTarget::Trino(trino_channel())));
    host.advance(0);
    assert!(executor.is_running(1));
    let cancelled = Rc::new(Cell::new(false));
    let flag = cancelled.clone();
    let cancel = executor.cancel(1);
    host.executor.spawn(Box::pin(async move {
        cancel.await;
        flag.set(true);
    }));
    host.advance(0);
    assert!(cancelled.get());
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    let sent = host.state.borrow().sent.clone();
    let delete = sent.last().unwrap();
    assert_eq!((delete.method.clone(), delete.url.clone()), (HttpMethod::Delete, next_uri(1)));
    assert_eq!(host.events().last().map(String::as_str), Some("cancelled"));
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
    let _outcome = start(&host, &executor, request(1, QueryTarget::Trino(trino_channel())));
    host.advance(0);
    let infos = || host.state.borrow().sent.iter().filter(|r| r.url.contains("/v1/query/")).count();
    assert_eq!(infos(), 0);
    executor.watch_profile(1, 1);
    host.advance(0);
    assert_eq!(infos(), 1);
    executor.watch_profile(1, -1);
    host.advance(0);
    executor.watch_profile(1, 0);
}

// Hyper

#[test]
fn hyper_reads_the_result_of_a_query_over_http() {
    let host = FakeHost::new();
    host.serve(move |request| {
        assert_eq!(request.url, format!("{HYPER}/api/v3/query"));
        assert_eq!(request.header("authorization"), Some("Bearer token"));
        let status = json!({ "queryId": "h1", "completionStatus": "RESULTS_PRODUCED", "chunkCount": 1, "rowCount": 3 });
        Answer::Now(Ok(HttpResponse::new(200, batch_ipc(&[1, 2, 3])).with_header("x-hyperdb-status", &status.to_string())))
    });
    let channel = HyperHttpChannel::connect(json!({ "endpoint": HYPER }).as_object().unwrap(), HyperChannelContext::default(), None).unwrap();
    let auth = Headers::from_pairs([("Authorization", "Bearer token")]);
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth }));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.events(), ["sending", "running", "progress:", "batch:0", "timing:Results", "all:3", "ready", "succeeded"]);
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
        Answer::Now(Ok(HttpResponse::new(200, batch_ipc(&[1, 2, 3])).with_header("x-hyperdb-status", &status.to_string())))
    });
    let channel = HyperHttpChannel::connect(json!({ "endpoint": HYPER }).as_object().unwrap(), HyperChannelContext::default(), None).unwrap();
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
                engine_progress: Some(EngineProgressPayload::HyperQueryStatus { status: status(fraction), received_at: at }),
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
    executor.set_progress_layout(Some(fb::ProfileLayoutConfig::new(
        56.0, 32.0, 28.0, 12.0, 12.0, 34.0, 8.0, 20, 8.5, 0.0, 40.0, top_down, 20.0,
    )));
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
fn hyper_fails_with_the_error_of_the_server() {
    let host = FakeHost::new();
    host.serve(|_| {
        let body = json!({ "code": 3, "message": "syntax error at end of input" });
        Answer::Now(Ok(HttpResponse::new(400, body.to_string()).with_header("Content-Type", "application/json")))
    });
    let channel = HyperHttpChannel::connect(json!({ "endpoint": HYPER }).as_object().unwrap(), HyperChannelContext::default(), None).unwrap();
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::HyperHttp { channel, auth: Headers::new() }));
    assert_eq!(resolved(&outcome), Some(false));
    let events = host.events();
    assert!(events.last().unwrap().starts_with("failed:"), "{events:?}");
}

// Channels of the host

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
        ["sending", "running", "progress:host", "batch:2", "batch:3", "timing:Results", "all:3", "touch", "ready", "succeeded"]
    );
    assert_eq!(host.state.borrow().channel_calls, ["open", "profile:false"]);
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
    assert_eq!(host.events(), ["sending", "running", "timing:Results", "ready", "succeeded"]);
}

#[test]
fn a_channel_without_a_result_succeeds_without_a_table() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_stream = false;
    let executor = QueryExecutor::new(host.clone());
    assert_eq!(resolved(&run(&host, &executor, request(1, QueryTarget::Host))), Some(false));
    assert_eq!(host.events(), ["sending", "timing:Results", "ready", "succeeded"]);
    assert!(host.log_messages().contains(&"Query returned no results".to_string()));
}

#[test]
fn a_channel_is_cancelled_at_the_backend_and_follows_the_profile() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_cancel_fails = true;
    let executor = QueryExecutor::new(host.clone());
    let outcome = start(&host, &executor, request(1, QueryTarget::Host));
    host.advance(0);
    // The channel learns of the views right away
    executor.watch_profile(1, 1);
    executor.watch_profile(1, 1);
    executor.watch_profile(1, -1);
    assert_eq!(host.state.borrow().channel_calls.last().map(String::as_str), Some("profile:true"));
    executor.watch_profile(1, -1);
    let _ = executor.cancel(1);
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(
        host.state.borrow().channel_calls,
        ["open", "profile:false", "profile:true", "profile:true", "profile:true", "profile:false", "cancel"]
    );
    assert!(host.log_messages().contains(&"Failed to cancel query at the backend".to_string()));
    assert_eq!(host.events(), ["sending", "running", "cancelled"]);
    // A query that ended ignores a cancel and a view
    let _ = executor.cancel(1);
    executor.watch_profile(1, 1);
}

#[test]
fn a_cancelled_query_does_not_reach_the_backend() {
    let host = FakeHost::new();
    let executor = QueryExecutor::new(host.clone());
    let outcome = start(&host, &executor, request(1, QueryTarget::Host));
    let _ = executor.cancel(1);
    host.advance(0);
    assert!(matches!(outcome.borrow().as_ref(), Some(QueryOutcome::Rejected(failure)) if failure.kind == FailureKind::Cancelled));
    assert!(host.state.borrow().channel_calls.is_empty());
    assert_eq!(host.events(), ["cancelled"]);
}

#[test]
fn a_failure_of_the_caller_is_recorded_without_running_the_query() {
    let host = FakeHost::new();
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.failure = Some(QueryFailure::new(FailureKind::Error, "bar.sql: unknown script :missing"));
    assert!(matches!(run(&host, &executor, query), QueryOutcome::Rejected(_)));
    assert_eq!(host.events(), ["failed:bar.sql: unknown script :missing"]);
    assert!(host.state.borrow().channel_calls.is_empty());
}

#[test]
fn a_failed_analysis_fails_the_query_and_rejects() {
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
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.kind, FailureKind::Processing);
    assert_eq!(
        host.events(),
        ["sending", "running", "batch:1", "timing:Results", "all:1", "ready", "processing", "timing:Postprocess", "failed:no compute"]
    );
}

// The query result cache

fn cached(key: &str) -> Option<CacheRequest> {
    Some(CacheRequest { key: key.into(), refresh: false })
}

#[test]
fn a_cached_result_is_served_without_the_backend() {
    let host = FakeHost::new();
    host.state.borrow_mut().cache.insert("k".into(), CacheEntry { name: "k.parquet".into(), cached_at: 1234.0 });
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.cache = cached("k");
    query.touches_relations = true;
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    assert_eq!(host.events(), ["all:1", "cache:k:true", "ready", "succeeded"]);
    assert_eq!(host.state.borrow().cache_calls, ["lookup:k", "read:k.parquet", "touch:k.parquet"]);
    assert!(host.log_messages().contains(&"Failed to record query cache access".to_string()));
    assert!(host.state.borrow().channel_calls.is_empty());
}

#[test]
fn a_miss_runs_the_query_and_stores_its_result() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.cache = cached("k");
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    host.advance(0);
    assert_eq!(host.state.borrow().cache_calls, ["lookup:k", "write:k"]);
    assert_eq!(host.events().last().map(String::as_str), Some("cache:k:false"));
    let flushed = Rc::new(Cell::new(false));
    let flag = flushed.clone();
    let flush = executor.flush_cache_writes();
    host.executor.spawn(Box::pin(async move {
        flush.await;
        flag.set(true);
    }));
    host.advance(0);
    assert!(flushed.get());
}

#[test]
fn an_unreadable_entry_is_a_miss_and_a_failed_write_only_logs() {
    let host = FakeHost::new();
    {
        let mut state = host.state.borrow_mut();
        state.cache_read_fails = true;
        state.cache_write_fails = true;
        state.cache.insert("k".into(), CacheEntry { name: "k.parquet".into(), cached_at: 1.0 });
        state.channel.push_back(Ok(ChannelMessage::Batch { metrics: metrics(1) }));
        state.channel.push_back(Ok(ChannelMessage::End { metrics: metrics(1) }));
    }
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.cache = cached("k");
    assert_eq!(resolved(&run(&host, &executor, query)), Some(true));
    host.advance(0);
    let logs = host.log_messages();
    assert!(logs.contains(&"Failed to read cached query result".to_string()));
    assert!(logs.contains(&"Failed to write query cache".to_string()));
    assert_eq!(host.events().last().map(String::as_str), Some("succeeded"));
}

#[test]
fn a_query_that_may_only_come_from_the_cache_fails_on_a_miss() {
    let host = FakeHost::new();
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.cache = Some(CacheRequest { key: "k".into(), refresh: false });
    query.cache_only = true;
    query.throw_on_error = true;
    query.touches_relations = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.kind, FailureKind::CacheMiss);
    assert!(host.state.borrow().channel_calls.is_empty());
    // Nothing ran, nothing touched the relations
    assert_eq!(host.events(), ["failed:The query result is not cached"]);
}

#[test]
fn a_refresh_skips_the_lookup() {
    let host = FakeHost::new();
    host.state.borrow_mut().channel_stream = false;
    let executor = QueryExecutor::new(host.clone());
    let mut query = request(1, QueryTarget::Host);
    query.cache = Some(CacheRequest { key: "k".into(), refresh: true });
    run(&host, &executor, query);
    assert!(host.state.borrow().cache_calls.is_empty());
}

// Client functions

fn salesforce_tokens() -> SalesforceTokens {
    SalesforceTokens::from_json(
        &json!({ "accessToken": "core-token", "instanceUrl": "https://org.my.salesforce.com" }).to_string(),
        &json!({ "instanceUrl": "https://tenant.c360a.salesforce.com/", "jwt": { "raw": "tenant-jwt" } }).to_string(),
    )
    .unwrap()
}

fn segment_spec() -> Rc<ClientFunctionSpec> {
    let spec = json!({
        "format": 1,
        "namespace": "cdp",
        "hosts": { "core": { "base_path": "/services/data/v{api_version}" } },
        "functions": [{ "name": "segment_list", "method": "GET", "host": "core", "path": "/ssot/segments", "rows": "/segments" }],
    });
    Rc::new(ClientFunctionSpec::from_value(spec).unwrap())
}

fn segment_call() -> ClientFunctionCallDescription {
    ClientFunctionCallDescription {
        namespace: "cdp".into(),
        function: "segment_list".into(),
        effect: "read".into(),
        ..ClientFunctionCallDescription::default()
    }
}

#[test]
fn a_client_function_call_asks_the_service() {
    let host = FakeHost::new();
    host.serve(|request| {
        assert_eq!(request.url, "https://org.my.salesforce.com/services/data/v68.0/ssot/segments");
        assert_eq!(request.header("Authorization"), Some("Bearer core-token"));
        json_response(json!({ "segments": [{ "apiName": "Vip" }, { "apiName": "New" }] }))
    });
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: Some(segment_spec()),
        description: segment_call(),
        tokens: Some(salesforce_tokens()),
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
        "namespace": "cdp",
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
        spec: Some(Rc::new(ClientFunctionSpec::from_value(spec).unwrap())),
        description,
        tokens: Some(salesforce_tokens()),
    };
    let executor = QueryExecutor::new(host.clone());
    let outcome = run(&host, &executor, request(1, QueryTarget::ClientFunction(target)));
    assert_eq!(resolved(&outcome), Some(true));
    assert_eq!(host.state.borrow().results.get(&1), Some(&3));
    // A batch per page
    assert_eq!(host.events().iter().filter(|event| event.starts_with("batch:")).count(), 2);
}

#[test]
fn a_client_function_call_fails_with_the_service_or_without_a_binding() {
    let host = FakeHost::new();
    host.serve(|_| Answer::Now(Ok(HttpResponse::new(403, json!([{ "message": "No access" }]).to_string()))));
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: Some(segment_spec()),
        description: segment_call(),
        tokens: Some(salesforce_tokens()),
    };
    let mut query = request(1, QueryTarget::ClientFunction(target.clone()));
    query.throw_on_error = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.details, [("status".to_string(), "403".to_string())]);

    let trino = ClientFunctionTarget { connector: ConnectorType::Trino, spec: None, ..target };
    let mut query = request(2, QueryTarget::ClientFunction(trino));
    query.throw_on_error = true;
    let QueryOutcome::Rejected(failure) = run(&host, &executor, query) else { panic!("expected a rejection") };
    assert_eq!(failure.message, "Trino connections have no client functions");
}

#[test]
fn a_client_function_call_stops_its_request_when_cancelled() {
    let host = FakeHost::new();
    host.serve(|_| Answer::Hold);
    let executor = QueryExecutor::new(host.clone());
    let target = ClientFunctionTarget {
        connector: ConnectorType::SalesforceDataCloud,
        spec: Some(segment_spec()),
        description: segment_call(),
        tokens: Some(salesforce_tokens()),
    };
    let outcome = start(&host, &executor, request(1, QueryTarget::ClientFunction(target)));
    host.advance(0);
    let _ = executor.cancel(1);
    host.advance(0);
    assert_eq!(resolved(outcome.borrow().as_ref().unwrap()), Some(false));
    assert_eq!(host.events(), ["sending", "cancelled"]);
}
