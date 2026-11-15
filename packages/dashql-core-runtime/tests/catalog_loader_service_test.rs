// The catalog loader as a service on a fake host: an executor of a single thread, a clock that only the test advances,
// metadata queries that the test answers and connections that the host changes like the registry of the app. The
// semantics follow packages/dashql-runtime/src/connections/catalog/catalog_loader_service.test.ts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use arrow_array::{ArrayRef, Int32Array, RecordBatch, StringArray};
use serde_json::{json, Value};

use dashql_core_runtime::catalog_loader::tables::relations_file_of_entry;
use dashql_core_runtime::catalog_loader::{
    CatalogLoaderHost, CatalogLoaderService, CatalogQuery, CatalogUpdateOutcome, FollowedConnection,
};
use dashql_core_runtime::connections::*;
use dashql_core_runtime::host::signal::{oneshot, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{CancellationToken, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::query::{QueryExecutionAction, QueryExecutionHistory, QueryExecutionState, QueryMetadata, QueryType};

/// 2026-01-01T00:00:00.000Z
const NOW: Timestamp = 1_767_225_600_000.0;
const SPEC: &str = "extensions/d360-api/clfn/spec/spec.json";

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

/// A metadata query that waits for its answer
struct PendingQuery {
    task_id: u32,
    query: CatalogQuery,
    answer: Option<Sender<Result<Vec<RecordBatch>, HostError>>>,
    token: CancellationToken,
}

type Service = CatalogLoaderService<FakeHost>;

#[derive(Default)]
struct State {
    /// What happened, without the logs
    events: Vec<String>,
    logs: Vec<(LogLevel, String)>,
    queries: Vec<PendingQuery>,
    /// The metadata of the API of the platform, none to fetch it
    metadata: Option<Value>,
    /// The answers of the HTTP server
    responses: VecDeque<HttpResponse>,
    sent: Vec<HttpRequest>,
    spec: Option<Result<String, String>>,
}

struct FakeHost {
    executor: Rc<Executor>,
    clock: Rc<Clock>,
    state: RefCell<State>,
    connections: RefCell<HashMap<String, FollowedConnection>>,
    service: RefCell<Option<Service>>,
}

impl FakeHost {
    fn new() -> Rc<Self> {
        let host = Rc::new(Self {
            executor: Rc::default(),
            clock: Rc::default(),
            state: RefCell::default(),
            connections: RefCell::default(),
            service: RefCell::new(None),
        });
        host.clock.now.set(NOW as u64);
        host
    }

    fn service(&self) -> Service {
        self.service.borrow().clone().unwrap()
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

    fn run(&self) {
        self.advance(0);
    }

    fn events(&self) -> Vec<String> {
        self.state.borrow().events.clone()
    }

    fn event(&self, event: String) {
        self.state.borrow_mut().events.push(event);
    }

    fn logged(&self, message: &str) -> bool {
        self.state.borrow().logs.iter().any(|(_, logged)| logged == message)
    }

    /// The texts of the metadata queries so far
    fn query_texts(&self) -> Vec<String> {
        self.state.borrow().queries.iter().map(|query| query.query.sql.clone()).collect()
    }

    fn query_count(&self) -> usize {
        self.state.borrow().queries.len()
    }

    /// Was a query cancelled?
    fn query_cancelled(&self, index: usize) -> bool {
        self.state.borrow().queries[index].token.is_cancelled()
    }

    /// Answer a query
    fn answer(&self, index: usize, answer: Result<Vec<RecordBatch>, &str>) {
        let sender = self.state.borrow_mut().queries[index].answer.take().expect("the query waits for its answer");
        sender.send(answer.map_err(HostError::new));
        self.run();
    }

    /// Apply an action to a connection, like the registry of the app
    fn apply(&self, connection_id: &str, action: ConnectionAction) {
        let connection = self.connections.borrow().get(connection_id).cloned().expect("a connection");
        let outcome = connection.state.borrow_mut().apply(action, self.clock.now.get() as f64).unwrap();
        for effect in outcome.effects {
            if let ConnectionEffect::CancelCatalogUpdate { task_id, reason } = effect {
                self.service().cancel(task_id, reason);
            }
        }
    }

    /// Hand the loader the connections, like the runtime does whenever the registry changed
    fn observe(&self) {
        let service = self.service();
        let mut ids: Vec<String> = self.connections.borrow().keys().cloned().collect();
        ids.sort();
        for id in &ids {
            let connection = self.connections.borrow().get(id).cloned().unwrap();
            service.follow(id, &connection);
        }
        service.observe(&ids);
        self.run();
    }

    fn connection(&self, connection_id: &str) -> FollowedConnection {
        self.connections.borrow().get(connection_id).cloned().unwrap()
    }

    fn updates(&self, connection_id: &str) -> CatalogUpdates {
        self.connection(connection_id).state.borrow().catalog_updates().clone()
    }
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        self.clock.now.get() as f64
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        let at = self.clock.now.get() + ms.max(0.0) as u64;
        let seq = self.clock.next_seq.get();
        self.clock.next_seq.set(seq + 1);
        let slot = Rc::new(TimerSlot { fired: Cell::new(false), waker: RefCell::new(None) });
        self.clock.timers.borrow_mut().insert((at, seq), slot.clone());
        Sleep { clock: self.clock.clone(), key: (at, seq), slot }
    }

    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, _details: &[(&str, &str)]) {
        self.state.borrow_mut().logs.push((level, message.to_string()));
    }
}

impl HttpHost for FakeHost {
    fn fetch(&self, request: HttpRequest, cancellation: &CancellationToken) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.sent.push(request);
        let response = state.responses.pop_front().ok_or_else(|| HostError::new("no response"));
        let cancelled = cancellation.is_cancelled();
        async move {
            if cancelled {
                return Err(HostError::new("The request was cancelled"));
            }
            response
        }
    }
}

impl CatalogLoaderHost for FakeHost {
    fn update_started(&self, connection_id: &str, task: &CatalogUpdateTask) {
        let variant = match task.variant {
            CatalogUpdateVariant::FullCatalogRefresh => "full",
            CatalogUpdateVariant::RelationRefresh => "relations",
        };
        self.event(format!("started {} {variant}", task.task_id));
        self.apply(connection_id, ConnectionAction::UpdateCatalog(task.clone()));
    }

    fn abort_update(&self, _connection_id: &str, task_id: u32, reason: &str) {
        self.event(format!("abort {task_id}"));
        self.service().cancel(task_id, reason);
    }

    fn update_finished(&self, connection_id: &str, task_id: u32, outcome: &CatalogUpdateOutcome) {
        self.event(format!("finished {task_id} {:?}", outcome.status));
        self.apply(connection_id, outcome.connection_action(task_id));
        if outcome.announces() {
            self.event(format!("announced {connection_id}"));
        }
    }

    fn run_query(
        &self,
        _connection_id: &str,
        task_id: u32,
        query: &CatalogQuery,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<Vec<RecordBatch>, HostError>> + 'static {
        let (sender, receiver) = oneshot();
        self.state.borrow_mut().queries.push(PendingQuery {
            task_id,
            query: query.clone(),
            answer: Some(sender),
            token: cancellation.clone(),
        });
        let token = cancellation.clone();
        async move {
            match token.run(receiver).await {
                Some(Some(answer)) => answer,
                Some(None) => Err(HostError::new("the query was dropped")),
                None => Err(HostError::new("Query was cancelled")),
            }
        }
    }

    fn salesforce_metadata(&self, _connection_id: &str, _data_space: &str) -> impl Future<Output = Result<Option<Value>, HostError>> + 'static {
        let metadata = self.state.borrow().metadata.clone();
        async move { Ok(metadata) }
    }

    fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static {
        self.event(format!("load spec {extension}"));
        let spec = self.state.borrow().spec.clone().unwrap_or_else(|| std::fs::read_to_string(SPEC).map_err(|e| e.to_string()));
        async move { spec.map_err(HostError::new) }
    }

    fn catalog_changed(&self, connection_id: &str) {
        self.event(format!("changed {connection_id}"));
    }
}

// The fixtures

fn object(value: Value) -> JsonObject {
    value.as_object().cloned().unwrap()
}

/// A loader on a host that follows a connection
fn setup(connector: ConnectorType, params: Value) -> Rc<FakeHost> {
    let host = FakeHost::new();
    *host.service.borrow_mut() = Some(CatalogLoaderService::new(host.clone()));
    add(&host, "database", connector, params);
    host.service().start();
    host
}

fn add(host: &FakeHost, connection_id: &str, connector: ConnectorType, params: Value) {
    let state = ConnectionState::from_params("", ConnectionParams::new(connector, object(params)), NOW);
    let connection = FollowedConnection {
        state: Rc::new(RefCell::new(state)),
        queries: Rc::new(RefCell::new(QueryExecutionHistory::new())),
    };
    host.connections.borrow_mut().insert(connection_id.to_string(), connection);
}

fn http() -> Value {
    json!({ "protocol": "V3_HTTP", "endpoint": "http://hyper.example" })
}

/// Bring a Hyper connection online with params
fn go_online(host: &FakeHost, params: Value) {
    let params = object(params);
    host.apply("database", ConnectionAction::Hyper(HyperAction::ChannelSetupStarted { params: params.clone() }));
    host.apply("database", ConnectionAction::Hyper(HyperAction::ChannelReady { channel: 1, params }));
    host.apply("database", ConnectionAction::HealthCheckSucceeded);
}

fn strings(values: &[&str]) -> ArrayRef {
    Arc::new(StringArray::from(values.to_vec()))
}

/// The rows of `pg_attribute` of one table
fn pg_rows(table: &str) -> Vec<RecordBatch> {
    vec![RecordBatch::try_from_iter(vec![
        ("table_schema", strings(&["public"])),
        ("table_name", strings(&[table])),
        ("column_name", strings(&["id"])),
        ("ordinal_position", Arc::new(Int32Array::from(vec![1])) as ArrayRef),
        ("data_type", strings(&["int8"])),
    ])
    .unwrap()]
}

const ORDERS: (&str, &str, &str) = ("hyper", "", "orders");

fn orders() -> RelationName {
    RelationName::new(ORDERS.0, ORDERS.1, ORDERS.2)
}

fn relations_text(host: &FakeHost) -> String {
    let connection = host.connection("database");
    let state = connection.state.borrow();
    let catalog = state.catalog().borrow();
    relations_file_of_entry(&catalog, state.relation_entry_id()).unwrap_or_default()
}

// The queue of refreshes

#[test]
fn a_forced_refresh_aborts_the_running_update_once_and_runs_after_it() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", false);
    host.run();
    assert_eq!(host.query_count(), 1);
    assert_eq!(host.events(), ["started 1 full"]);

    host.service().enqueue("database", true);
    // A request that isn't forced doesn't take the force back
    host.service().enqueue("database", false);
    host.run();
    assert!(host.query_cancelled(0));
    let events = host.events();
    assert_eq!(events.iter().filter(|event| event.starts_with("abort")).count(), 1, "{events:?}");
    assert!(events.contains(&"finished 1 Cancelled".to_string()), "{events:?}");
    assert_eq!(host.query_count(), 2);
    assert!(!host.query_cancelled(1));
    assert_eq!(host.updates("database").tasks_finished.get(&1).unwrap().error.as_ref().unwrap().message, "Superseded by forced catalog refresh");

    host.observe();
    assert_eq!(host.query_count(), 2);
    host.answer(1, Ok(pg_rows("orders")));
    assert!(host.events().contains(&"finished 2 Succeeded".to_string()), "{:?}", host.events());
    assert!(host.events().contains(&"announced database".to_string()));
    assert!(relations_text(&host).contains("orders"));
    // The bundled functions of Hyper came with the refresh
    assert!(host.connection("database").state.borrow().function_script().unwrap().to_text().contains("CREATE FUNCTION"));
    host.observe();
    assert_eq!(host.query_count(), 2);
}

#[test]
fn an_update_that_failed_is_tried_once_more_without_another_request() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    host.service().enqueue("database", false);
    host.run();
    assert_eq!(host.query_count(), 1);
    host.answer(0, Err("metadata unavailable"));
    assert!(host.events().contains(&"finished 1 Failed".to_string()));
    assert!(!host.events().iter().any(|event| event.starts_with("announced")));
    assert!(host.logged("Failed to update catalog"));
    // The request that wasn't forced is still queued and the connection isn't described
    assert_eq!(host.query_count(), 2);
    host.answer(1, Ok(pg_rows("orders")));
    host.observe();
    assert_eq!(host.query_count(), 2);
}

#[test]
fn a_request_after_a_refresh_that_described_the_connection_is_consumed() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    host.service().enqueue("database", false);
    host.run();
    host.answer(0, Ok(pg_rows("orders")));
    assert_eq!(host.query_count(), 1);
    host.observe();
    assert_eq!(host.query_count(), 1);
    host.service().enqueue("database", true);
    host.run();
    assert_eq!(host.query_count(), 2);
    assert!(!host.query_cancelled(1));
}

#[test]
fn a_database_com_connection_reads_the_hyper_cloud_database_it_attaches() {
    let host = setup(ConnectorType::Dbcom, json!({ "databaseName": "sales" }));
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    let texts = host.query_texts();
    assert_eq!(texts.len(), 1);
    assert!(texts[0].contains("\"lakehouse\".\"_hyper_catalog\""), "{}", texts[0]);
    assert!(host.state.borrow().queries[0].query.title.contains("lakehouse"));
    assert_eq!(host.state.borrow().queries[0].task_id, 1);
}

// The connections that come online

#[test]
fn the_catalog_of_an_embedded_database_is_described_whenever_it_comes_online() {
    let host = setup(ConnectorType::Hyper, json!({ "protocol": "WASM" }));
    go_online(&host, json!({ "protocol": "WASM" }));
    host.observe();
    assert_eq!(host.query_count(), 1);
    host.answer(0, Ok(pg_rows("orders")));
    // The embedded database reads its functions from pg_proc
    assert_eq!(host.query_count(), 2);
    assert_eq!(host.state.borrow().queries[1].query.query_type, QueryType::CatalogQueryPgProc);
    host.answer(1, Ok(Vec::new()));
    assert!(host.events().contains(&"finished 1 Succeeded".to_string()), "{:?}", host.events());
    host.observe();
    assert_eq!(host.query_count(), 2);

    // A reconnect describes the new database again
    host.apply("database", ConnectionAction::HealthCheckStarted);
    host.observe();
    host.apply("database", ConnectionAction::HealthCheckSucceeded);
    host.observe();
    assert_eq!(host.query_count(), 3);
}

#[test]
fn a_restored_catalog_of_a_durable_connection_is_kept() {
    let host = setup(ConnectorType::Hyper, http());
    go_online(&host, http());
    host.connection("database").state.borrow_mut().restore_catalog_updates(Some(true), None);
    host.observe();
    assert_eq!(host.query_count(), 0);
}

#[test]
fn a_durable_connection_without_a_catalog_is_described_when_it_comes_online() {
    let host = setup(ConnectorType::Hyper, http());
    go_online(&host, http());
    host.observe();
    assert_eq!(host.query_count(), 1);
    assert_eq!(host.events(), ["started 1 full"]);
}

// The relations of executed statements

fn touch(host: &FakeHost) {
    go_online(host, http());
    host.connection("database").state.borrow_mut().restore_catalog_updates(Some(true), Some(vec![orders()]));
}

fn add_query(host: &FakeHost, query_id: u64) {
    let metadata = QueryMetadata::new(QueryType::UserProvided);
    let state = QueryExecutionState::new(query_id, 0, "select 1", metadata, NOW as i64);
    host.connection("database").queries.borrow_mut().apply(QueryExecutionAction::ExecuteQuery { state: Box::new(state) }).unwrap();
}

#[test]
fn the_relations_are_asked_about_once_the_connection_has_room_for_another_query() {
    let host = setup(ConnectorType::Hyper, http());
    touch(&host);
    for query_id in 1..=4 {
        add_query(&host, query_id);
    }
    host.observe();
    assert_eq!(host.query_count(), 0);
    host.connection("database").queries.borrow_mut().clear("Connection was reset");
    host.observe();
    assert_eq!(host.query_count(), 1);
    assert!(host.query_texts()[0].contains("'orders'"), "{}", host.query_texts()[0]);
    assert_eq!(host.events(), ["started 1 relations"]);
    host.answer(0, Ok(pg_rows("orders")));
    assert!(host.events().contains(&"announced database".to_string()));
    assert!(host.updates("database").touched_relations.is_empty());
}

#[test]
fn the_relations_wait_for_a_running_refresh_that_may_have_read_them_too_early() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", false);
    host.run();
    assert_eq!(host.query_count(), 1);
    touch(&host);
    host.observe();
    assert_eq!(host.query_count(), 1);
    host.answer(0, Ok(pg_rows("customers")));
    assert_eq!(host.query_count(), 2);
    assert!(host.query_texts()[1].contains("'orders'"));
}

#[test]
fn the_relations_are_asked_about_again_after_a_wait_when_the_update_failed() {
    let host = setup(ConnectorType::Hyper, http());
    touch(&host);
    host.observe();
    assert_eq!(host.query_count(), 1);
    host.answer(0, Err("down"));
    assert_eq!(host.updates("database").touched_relations, vec![orders()]);
    assert_eq!(host.updates("database").touched_failures, 1);
    host.observe();
    host.advance(1999);
    assert_eq!(host.query_count(), 1);
    host.advance(1);
    assert_eq!(host.query_count(), 2);
    host.answer(1, Ok(pg_rows("orders")));
    assert_eq!(host.updates("database").touched_failures, 0);
}

#[test]
fn the_relations_are_not_asked_about_once_the_attempts_are_used_up() {
    let host = setup(ConnectorType::Hyper, http());
    touch(&host);
    for task_id in 101..101 + MAX_TOUCHED_ATTEMPTS {
        let task = CatalogUpdateTask { touched_relations: vec![orders()], ..CatalogUpdateTask::new(task_id, CatalogUpdateVariant::RelationRefresh, NOW) };
        host.apply("database", ConnectionAction::UpdateCatalog(task));
        host.apply("database", ConnectionAction::CatalogUpdateFailed { task_id, error: DetailedError::new("down") });
    }
    host.observe();
    host.advance(60_000);
    assert_eq!(host.query_count(), 0);
}

#[test]
fn a_forced_refresh_runs_ahead_of_a_lookup_that_keeps_coming_back() {
    let host = setup(ConnectorType::Hyper, http());
    touch(&host);
    host.observe();
    assert_eq!(host.query_count(), 1);
    host.service().enqueue("database", true);
    host.run();
    assert!(host.query_cancelled(0));
    // The refresh runs, the lookup gave its relation back and follows it
    assert_eq!(host.query_count(), 2);
    assert!(!host.query_texts()[1].contains("'orders'"));
    host.answer(1, Ok(pg_rows("customers")));
    assert_eq!(host.query_count(), 3);
    assert!(host.query_texts()[2].contains("'orders'"));
}

// Cancellation

#[test]
fn a_reset_cancels_the_update_and_nothing_is_published() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    host.apply("database", ConnectionAction::Reset);
    host.run();
    assert!(host.query_cancelled(0));
    assert!(!host.relations_published());
    assert!(!host.service().is_running(1));
}

impl FakeHost {
    fn relations_published(&self) -> bool {
        relations_text(self).contains("CREATE TABLE")
    }
}

#[test]
fn a_running_update_logs_that_it_still_runs() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    host.advance(5000);
    assert!(host.logged("Catalog update in progress"));
    host.answer(0, Ok(pg_rows("orders")));
    assert!(host.logged("Finished catalog update"));
}

#[test]
fn an_update_outside_of_the_schedule_runs_to_its_end() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    let (task_id, done) = host.service().update("database", Some(vec![orders()]));
    let result = Rc::new(RefCell::new(None));
    let out = result.clone();
    host.spawn(Box::pin(async move {
        *out.borrow_mut() = Some(done.await);
    }));
    host.run();
    assert_eq!(host.query_count(), 1);
    host.answer(0, Ok(pg_rows("orders")));
    assert_eq!(*result.borrow(), Some(Ok(())));
    assert!(host.events().contains(&format!("finished {task_id} Succeeded")));

    let (_, missing) = host.service().update("missing", None);
    let result = Rc::new(RefCell::new(None));
    let out = result.clone();
    host.spawn(Box::pin(async move {
        *out.borrow_mut() = Some(missing.await.is_err());
    }));
    host.run();
    assert_eq!(*result.borrow(), Some(true));
}

// Salesforce

fn salesforce(host: &FakeHost) {
    host.apply("database", ConnectionAction::Salesforce(SalesforceAction::ReceivedCoreAuthToken(
        r#"{"accessToken":"core-token","instanceUrl":"https://example.my.salesforce.com"}"#.to_string(),
    )));
    host.apply("database", ConnectionAction::Salesforce(SalesforceAction::ReceivedDataCloudAccessToken("{\"jwt\":{}}".to_string())));
}

fn metadata(name: &str) -> Value {
    json!({ "metadata": [{ "name": name, "fields": [{ "name": "Id__c", "type": "Text" }] }] })
}

#[test]
fn salesforce_fetches_its_metadata_from_the_instance() {
    let host = setup(ConnectorType::SalesforceDataCloud, json!({ "instanceUrl": "https://example.my.salesforce.com" }));
    salesforce(&host);
    {
        let mut state = host.state.borrow_mut();
        state.responses.push_back(HttpResponse::new(200, metadata("Account__dlm").to_string()));
        state.responses.push_back(HttpResponse::new(500, "down".to_string()));
        state.responses.push_back(HttpResponse::new(200, json!({ "metadata": [] }).to_string()));
    }
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    assert!(host.events().contains(&"finished 1 Succeeded".to_string()), "{:?}", host.events());
    let sent: Vec<String> = host.state.borrow().sent.iter().map(|request| request.url.clone()).collect();
    assert_eq!(sent.len(), 3);
    assert!(sent[0].starts_with("https://example.my.salesforce.com/services/data/"), "{}", sent[0]);
    assert!(sent[0].contains("entityType=DataModelObject"));
    assert!(host.logged("Salesforce metadata request failed"));
    assert!(relations_text(&host).contains("\"Account__dlm\""));
    assert_eq!(host.query_count(), 0);
}

#[test]
fn salesforce_reads_the_metadata_of_the_api_of_the_platform() {
    let host = setup(ConnectorType::SalesforceDataCloud, json!({ "instanceUrl": "https://example.my.salesforce.com" }));
    salesforce(&host);
    host.state.borrow_mut().metadata = Some(metadata("Mocked__dlm"));
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    assert!(host.state.borrow().sent.is_empty());
    assert!(relations_text(&host).contains("\"Mocked__dlm\""));
}

#[test]
fn salesforce_without_a_login_fails_its_update() {
    let host = setup(ConnectorType::SalesforceDataCloud, json!({}));
    host.observe();
    host.service().enqueue("database", true);
    host.run();
    assert!(host.events().contains(&"finished 1 Failed".to_string()), "{:?}", host.events());
}

// The client functions

#[test]
fn the_client_functions_of_a_connection_are_registered_and_announced() {
    let host = setup(ConnectorType::SalesforceDataCloud, json!({}));
    host.observe();
    let events = host.events();
    assert!(events.contains(&"load spec d360-api".to_string()), "{events:?}");
    assert!(events.contains(&"changed database".to_string()), "{events:?}");
    // Once
    host.observe();
    assert_eq!(host.events().iter().filter(|event| event.starts_with("load spec")).count(), 1);
}

#[test]
fn a_spec_that_fails_to_load_is_tried_again_with_the_next_change() {
    let host = setup(ConnectorType::SalesforceDataCloud, json!({}));
    host.state.borrow_mut().spec = Some(Err("chunk failed".to_string()));
    host.observe();
    assert!(host.logged("Failed to register client functions"));
    assert!(!host.events().contains(&"changed database".to_string()));
    host.state.borrow_mut().spec = None;
    host.observe();
    assert!(host.events().contains(&"changed database".to_string()));
}

#[test]
fn a_hyper_connection_has_no_client_functions() {
    let host = setup(ConnectorType::Hyper, http());
    host.observe();
    assert!(!host.events().iter().any(|event| event.starts_with("load spec")));
}
