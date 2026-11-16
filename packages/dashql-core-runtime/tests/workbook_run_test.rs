// The runs of workbooks on a fake host: an executor of a single thread and statements that the test answers, at once
// or when it releases them. The workbooks are real, the run analyzes and plans their scripts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Wake, Waker};

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core_runtime::executor::QueryId;
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::workbook::{new_catalog, ScriptConnection, ScriptConnectionProfile, Workbook, WorkbookAction, WorkbookEffect};
use dashql_core_runtime::workbook_run::{
    start_run, PlanRun, RetainedFile, RunFailureKind, RunHost, RunOptions, RunPhase, RunResult, RunState, ScriptEvent,
    StatementCache, StatementFailure, StatementHandle, StatementRequest,
};

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

    /// Poll the tasks until none can make progress
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

// The host

/// A statement that the run handed to the host
struct Statement {
    query_id: QueryId,
    request: StatementRequest,
    /// Ends the statement in a gated test, its result is ready then too
    done: Option<(Sender<()>, Sender<Result<bool, StatementFailure>>)>,
}

#[derive(Default)]
struct HostState {
    /// The statements in the order of the run
    statements: Vec<Statement>,
    /// What happened, in order: statements, writes, cancellations
    calls: Vec<String>,
    /// The events of the scripts by file
    events: Vec<(String, String)>,
    /// The states of the run
    states: Vec<RunState>,
    /// The keys whose results the cache holds
    cached: BTreeSet<String>,
    /// The connections that can't run
    offline: BTreeSet<String>,
    /// The connections that cache no query results
    uncached: BTreeSet<String>,
    /// The texts of statements that fail
    failing: Vec<String>,
    /// How often the run told that it changed the workbook, and the effects it passed on
    changes: usize,
    effects: Vec<WorkbookEffect>,
    /// Do the statements that serve cached results wait for the test?
    gate_cached: bool,
    /// Are the cached results gone when they are read?
    missing: bool,
    /// Does the host set up the connections of a run, the ones that fail, and a gate that the setups wait for
    prepares: bool,
    failing_setups: BTreeSet<String>,
    prepare_gate: Option<Receiver<()>>,
    /// Gates that the next retain of a cached file and the next pin wait for
    retain_gate: Option<Receiver<()>>,
    pin_gate: Option<Receiver<()>>,
}

struct FakeHost {
    executor: Rc<Executor>,
    state: Rc<RefCell<HostState>>,
    /// Do the statements end at once? Otherwise the test ends them.
    auto: bool,
    /// The mount prefix of the materialized results
    mounts: Option<String>,
    /// The statements of a connection that run at once
    concurrency: usize,
    next_query: Cell<QueryId>,
    /// The ids of the files that the host keeps for the runs
    next_file: Cell<u64>,
    /// Is the workbook still the one of the app?
    live: Cell<bool>,
}

impl FakeHost {
    fn next_file(&self) -> u64 {
        self.next_file.set(self.next_file.get() + 1);
        self.next_file.get()
    }
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        1000.0
    }
    fn sleep(&self, _ms: f64) -> impl Future<Output = ()> + 'static {
        std::future::ready(())
    }
    fn spawn(&self, task: LocalTask) {
        self.executor.spawn(task);
    }
    fn log(&self, _level: LogLevel, _message: &str, _details: &[(&str, &str)]) {}
}

impl RunHost for FakeHost {
    fn execute(&self, request: StatementRequest) -> Result<StatementHandle, StatementFailure> {
        let query_id = self.next_query.get() + 1;
        self.next_query.set(query_id);
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("execute {}", request.text));
        let fails = state.failing.iter().any(|text| request.text.contains(text.as_str()));
        let cached = matches!(&request.cache, StatementCache::Only { .. });
        let miss = cached && (state.missing || !state.cached.iter().any(|key| key.ends_with(&format!(":{}", signature_of(&request)))));
        if (self.auto && !(cached && state.gate_cached)) || (cached && !state.gate_cached) {
            let end = if fails {
                Err(StatementFailure::new(format!("{} failed", request.text)))
            } else if miss {
                Err(StatementFailure { message: "miss".into(), cache_miss: true, value: None })
            } else {
                Ok(request.publish_results)
            };
            state.statements.push(Statement { query_id, request, done: None });
            return Ok(StatementHandle { query_id, ready: Box::pin(std::future::ready(())), done: Box::pin(std::future::ready(end)) });
        }
        let (sender, receiver) = oneshot();
        let (ready, readiness) = oneshot();
        state.statements.push(Statement { query_id, request, done: Some((ready, sender)) });
        Ok(StatementHandle {
            query_id,
            ready: Box::pin(async move {
                readiness.await;
            }),
            done: Box::pin(async move { receiver.await.unwrap_or_else(|| Err(StatementFailure::new("dropped"))) }),
        })
    }

    fn cancel(&self, _connection_id: &str, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("cancel {query_id}"));
        let sender = state.statements.iter_mut().find(|s| s.query_id == query_id).and_then(|s| s.done.take());
        if let Some((ready, sender)) = sender {
            ready.send(());
            sender.send(Err(StatementFailure::new("Query was cancelled")));
        }
        std::future::ready(())
    }

    fn result_key(&self, connection_id: &str, signature: &str) -> impl Future<Output = Option<String>> + 'static {
        std::future::ready(Some(format!("{connection_id}:{signature}")))
    }
    fn caches_results(&self, connection_id: &str) -> bool {
        !self.state.borrow().uncached.contains(connection_id)
    }
    fn can_run(&self, connection_id: &str) -> bool {
        !self.state.borrow().offline.contains(connection_id)
    }
    fn max_concurrent_queries(&self, _connection_id: &str) -> usize {
        self.concurrency
    }
    fn prepares_connections(&self) -> bool {
        self.state.borrow().prepares
    }
    fn prepare_connection(&self, connection_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("prepare {connection_id}"));
        let gate = state.prepare_gate.take();
        let fails = state.failing_setups.contains(connection_id);
        async move {
            if let Some(gate) = gate {
                gate.await;
            }
            if fails { Err(HostError::new("the setup failed")) } else { Ok(()) }
        }
    }
    fn has_cache(&self) -> bool {
        true
    }
    fn cache_retain(&self, key: &str) -> impl Future<Output = Result<Option<RetainedFile>, HostError>> + 'static {
        let found = self.state.borrow().cached.contains(key);
        let file = found.then(|| RetainedFile { id: self.next_file(), name: format!("{}.parquet", key.len()) });
        let mut state = self.state.borrow_mut();
        if let Some(file) = &file {
            state.calls.push(format!("retain {}", file.id));
        }
        let gate = state.retain_gate.take();
        async move {
            if let Some(gate) = gate {
                gate.await;
            }
            Ok(file)
        }
    }
    fn cache_release(&self, file: u64) -> impl Future<Output = ()> + 'static {
        self.state.borrow_mut().calls.push(format!("release {file}"));
        std::future::ready(())
    }
    fn mount_prefix(&self) -> Option<String> {
        self.mounts.clone()
    }
    fn mount_file_name(&self, key: Option<&str>) -> String {
        if key.is_some() { "keyed.parquet".to_string() } else { "transient.parquet".to_string() }
    }
    fn mount_pin(&self, path: &str) -> impl Future<Output = Result<u64, HostError>> + 'static {
        let pin = self.next_file();
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("pin {pin} {path}"));
        let gate = state.pin_gate.take();
        async move {
            if let Some(gate) = gate {
                gate.await;
            }
            Ok(pin)
        }
    }
    fn mount_write(&self, path: &str, query_id: QueryId) -> impl Future<Output = Result<u64, HostError>> + 'static {
        self.state.borrow_mut().calls.push(format!("write {query_id} {path}"));
        std::future::ready(Ok(1))
    }
    fn mount_remove(&self, name: &str) -> impl Future<Output = ()> + 'static {
        self.state.borrow_mut().calls.push(format!("remove {name}"));
        std::future::ready(())
    }
    fn mounts_attachments(&self) -> bool {
        false
    }
    fn mount_attachments(&self) -> impl Future<Output = Result<(), HostError>> + 'static {
        std::future::ready(Ok(()))
    }
    fn workbook_live(&self) -> bool {
        self.live.get()
    }
    fn workbook_changed(&self, effects: Vec<WorkbookEffect>, _analyzed: bool) {
        let mut state = self.state.borrow_mut();
        state.changes += 1;
        state.effects.extend(effects);
    }
    fn state(&self, state: &RunState) {
        self.state.borrow_mut().states.push(state.clone());
    }
    fn script_event(&self, file: &str, event: &ScriptEvent) {
        let name = match event {
            ScriptEvent::Planned { .. } => "planned",
            ScriptEvent::Cached { .. } => "cached",
            ScriptEvent::Skipped { .. } => "skipped",
            ScriptEvent::Started => "started",
            ScriptEvent::Done { .. } => "done",
            ScriptEvent::Failed { .. } => "failed",
            ScriptEvent::Cancelled => "cancelled",
        };
        self.state.borrow_mut().events.push((file.to_string(), name.to_string()));
    }
    fn cooperate(&self) -> impl Future<Output = ()> + 'static {
        std::future::ready(())
    }
}

/// The signature of a statement that reads the cache
fn signature_of(request: &StatementRequest) -> String {
    match &request.cache {
        StatementCache::Only { signature } | StatementCache::Refresh { signature } => signature.clone(),
        StatementCache::None => String::new(),
    }
}

// The setup

fn connection(id: &str, local: bool) -> Rc<ScriptConnection> {
    let profile = ScriptConnectionProfile {
        dialect: FormattingDialect::HYPER,
        local,
        params: None,
        default_database: String::new(),
        default_schema: String::new(),
    };
    Rc::new(ScriptConnection::new(id, Rc::new(RefCell::new(new_catalog())), profile))
}

/// A workbook with scripts on connections, in feed order
fn workbook(scripts: &[(&str, &str, &Rc<ScriptConnection>)]) -> Rc<RefCell<Workbook>> {
    let mut workbook = Workbook::new("workbook", None, None, EditorOffsetUnit::UTF16_CODE_UNITS);
    for (file, text, connection) in scripts {
        workbook.add_stored_script(file, text, (*connection).clone(), None).unwrap();
    }
    Rc::new(RefCell::new(workbook))
}

struct Setup {
    executor: Rc<Executor>,
    state: Rc<RefCell<HostState>>,
    host: Rc<FakeHost>,
}

fn setup(auto: bool, mounts: Option<&str>, concurrency: usize) -> Setup {
    let executor = Rc::new(Executor::default());
    let state = Rc::new(RefCell::new(HostState::default()));
    let host = Rc::new(FakeHost {
        executor: executor.clone(),
        state: state.clone(),
        auto,
        mounts: mounts.map(str::to_string),
        concurrency,
        next_query: Cell::new(0),
        next_file: Cell::new(0),
        live: Cell::new(true),
    });
    Setup { executor, state, host }
}

fn workbook_run() -> RunOptions {
    RunOptions { run: PlanRun::Workbook, targets: None, inputs: None, refresh: false, reports_state: true, analyze: true }
}

impl Setup {
    /// Start a run, the result lands in the returned cell
    fn start(&self, workbook: &Rc<RefCell<Workbook>>, options: RunOptions) -> (dashql_core_runtime::workbook_run::RunHandle<FakeHost>, Rc<RefCell<Option<RunResult>>>) {
        let (handle, run) = start_run(self.host.clone(), workbook.clone(), options);
        let result = Rc::new(RefCell::new(None));
        let slot = result.clone();
        self.executor.spawn(Box::pin(async move {
            *slot.borrow_mut() = Some(run.await);
        }));
        self.executor.run_until_stalled();
        (handle, result)
    }

    /// Run to the end
    fn run(&self, workbook: &Rc<RefCell<Workbook>>, options: RunOptions) -> RunResult {
        let (_handle, result) = self.start(workbook, options);
        self.executor.run_until_stalled();
        let result = result.borrow_mut().take();
        result.expect("the run ended")
    }

    fn texts(&self) -> Vec<String> {
        self.state.borrow().statements.iter().map(|s| s.request.text.clone()).collect()
    }

    fn events(&self, file: &str) -> Vec<String> {
        self.state.borrow().events.iter().filter(|(f, _)| f == file).map(|(_, e)| e.clone()).collect()
    }

    fn last_state(&self) -> RunState {
        self.state.borrow().states.last().cloned().expect("a state")
    }

    /// End a statement of a gated test
    fn end(&self, text: &str, end: Result<bool, StatementFailure>) {
        let sender = self.state.borrow_mut().statements.iter_mut().find(|s| s.request.text.contains(text)).and_then(|s| s.done.take());
        let (ready, done) = sender.expect("a running statement");
        ready.send(());
        done.send(end);
        self.executor.run_until_stalled();
    }
}

#[test]
fn runs_the_scripts_of_a_workbook_in_the_order_of_the_plan() {
    let main = connection("main", true);
    let workbook = workbook(&[
        ("1_create.sql", "create table items (id int)", &main),
        ("2_insert.sql", "insert into items values (1)", &main),
        ("3_query.sql", "select id from items", &main),
        ("4_empty.sql", "", &main),
    ]);
    let s = setup(true, None, 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["create table items (id int)", "insert into items values (1)", "select id from items"]);
    let state = s.last_state();
    assert_eq!(state.phase, RunPhase::Succeeded);
    assert_eq!((state.total_scripts, state.completed_scripts), (4, 4));
    assert_eq!((state.total_statements, state.completed_statements), (3, 3));
    assert_eq!(s.events("3_query.sql"), vec!["planned", "started", "done"]);
    assert_eq!(s.events("4_empty.sql"), vec!["done"]);
    // The query registered on its script, its result is the result of the script
    let query = s.state.borrow().statements.iter().find(|s| s.request.text.starts_with("select")).map(|s| s.query_id).unwrap();
    let workbook = workbook.borrow();
    let script = workbook.script_by_file("3_query.sql").unwrap();
    assert_eq!(script.latest_query_id(), Some(query as u32));
    assert_eq!(script.latest_result_query_id(), Some(query as u32));
    assert_eq!(result.outputs.get(2).copied().flatten(), Some(query));
    // Only the output of a script analyzes its result, the planned statement says where it comes from
    let statements = &s.state.borrow().statements;
    assert!(!statements[0].request.analyze_results && statements[2].request.analyze_results);
    assert_eq!(statements[2].request.planned.title(), "3_query.sql 1/1");
}

#[test]
fn a_failed_statement_cancels_the_running_statements_and_fails_the_run() {
    let (a, b) = (connection("a", false), connection("b", false));
    let workbook = workbook(&[("1_a.sql", "select 1", &a), ("2_b.sql", "select 2", &b)]);
    let s = setup(false, None, 1);
    let (_handle, result) = s.start(&workbook, workbook_run());
    // The statements of the two connections run at once
    assert_eq!(s.texts(), vec!["select 1", "select 2"]);
    s.end("select 1", Err(StatementFailure::new("boom")));
    let result = result.borrow_mut().take().expect("the run ended");
    let failure = result.failure.expect("a failure");
    assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Error, "boom"));
    assert!(s.state.borrow().calls.iter().any(|call| call == "cancel 2"));
    assert_eq!(s.events("1_a.sql"), vec!["planned", "started", "failed"]);
    assert_eq!(s.events("2_b.sql"), vec!["planned", "started", "cancelled"]);
    let state = s.last_state();
    assert_eq!((state.phase, state.error.as_deref()), (RunPhase::Failed, Some("boom")));
}

#[test]
fn runs_one_statement_of_a_connection_at_a_time_and_stops_when_cancelled() {
    let main = connection("main", false);
    let workbook = workbook(&[("1_a.sql", "select 1", &main), ("2_b.sql", "select 2", &main)]);
    let s = setup(false, None, 1);
    let (handle, result) = s.start(&workbook, workbook_run());
    assert_eq!(s.texts(), vec!["select 1"]);
    s.end("select 1", Ok(true));
    assert_eq!(s.texts(), vec!["select 1", "select 2"]);
    handle.cancel();
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|f| f.kind), Some(RunFailureKind::Cancelled));
    assert!(s.state.borrow().calls.iter().any(|call| call == "cancel 2"));
    assert!(s.state.borrow().states.iter().any(|state| state.phase == RunPhase::Stopping));
    assert_eq!(s.last_state().phase, RunPhase::Cancelled);
}

#[test]
fn serves_the_cached_results_of_scripts_and_runs_the_others() {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main), ("bar.sql", "select a + 1 from :foo", &main)]);
    let s = setup(true, None, 1);
    // A first run writes the results of the reusable keys
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let signatures: Vec<String> = s.state.borrow().statements.iter().map(|s| signature_of(&s.request)).collect();
    assert!(s.state.borrow().statements.iter().all(|s| matches!(s.request.cache, StatementCache::Refresh { .. })));
    assert_eq!(s.texts(), vec!["select 1 as a", "with foo as (\nselect 1 as a\n)\nselect a + 1 from foo"]);
    // The cache holds the result of foo, it is served and bar runs
    s.state.borrow_mut().statements.clear();
    s.state.borrow_mut().cached.insert(format!("main:{}", signatures[0]));
    let second = s.run(&workbook, workbook_run());
    assert!(second.failure.is_none(), "{:?}", second.failure);
    let statements = &s.state.borrow().statements;
    assert!(matches!(statements[0].request.cache, StatementCache::Only { .. }) && statements[0].request.planned.cached);
    assert!(matches!(statements[1].request.cache, StatementCache::Refresh { .. }));
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("cached"));
}

#[test]
fn materializes_a_script_of_another_connection_before_the_scan() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let calls = s.state.borrow().calls.clone();
    assert_eq!(calls.first().map(String::as_str), Some("execute select 1 as a"));
    // The run pins the file before it writes it and releases the pin once it ended
    assert_eq!(calls.get(1).map(String::as_str), Some("pin 1 /mnt/cache/keyed.parquet"));
    assert_eq!(calls.get(2).map(String::as_str), Some("write 1 /mnt/cache/keyed.parquet"));
    assert!(calls.get(3).is_some_and(|call| call.starts_with("execute") && call.contains("/mnt/cache/keyed.parquet")));
    assert_eq!(calls.last().map(String::as_str), Some("release 1"));
    // Without the mounts the run fails before its first statement
    let s = setup(true, None, 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.unwrap().message.contains("need the compute database"));
    assert!(s.texts().is_empty());
}

#[test]
fn removes_the_transient_files_of_a_run_after_it_released_their_pins() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    // The result of a connection that caches nothing has no reusable key, it is a transient file of the run
    s.state.borrow_mut().uncached.insert("remote".to_string());
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let calls = s.state.borrow().calls.clone();
    assert_eq!(calls.get(1).map(String::as_str), Some("pin 1 /mnt/cache/transient.parquet"));
    let tail: Vec<&str> = calls.iter().skip(calls.len().saturating_sub(2)).map(String::as_str).collect();
    assert_eq!(tail, vec!["release 1", "remove transient.parquet"]);
}

#[test]
fn releases_the_pins_of_a_failed_run_once_its_statements_settled() {
    let (local, remote, other) = (connection("local", true), connection("remote", false), connection("other", false));
    let workbook = workbook(&[
        ("foo.sql", "select 1 as a", &remote),
        ("bar.sql", "select count(*) from :foo", &local),
        ("baz.sql", "select 2", &other),
    ]);
    let s = setup(false, Some("/mnt/cache"), 1);
    let (open, gate) = oneshot();
    s.state.borrow_mut().pin_gate = Some(gate);
    let (_handle, result) = s.start(&workbook, workbook_run());
    // The result of foo arrived, the pin of its file is pending when baz fails
    s.end("select 1 as a", Ok(true));
    assert!(s.state.borrow().calls.iter().any(|call| call == "pin 1 /mnt/cache/keyed.parquet"));
    s.end("select 2", Err(StatementFailure::new("boom")));
    // The run waits for the statement of foo before it releases the files
    assert!(result.borrow().is_none());
    open.send(());
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|failure| failure.message), Some("boom".to_string()));
    assert_eq!(s.state.borrow().calls.last().map(String::as_str), Some("release 1"));
}

#[test]
fn releases_a_cached_file_that_was_retained_while_the_run_stopped() {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main)]);
    let s = setup(true, None, 1);
    // A first run learns the signature of the result of foo, the cache holds it then
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let signature = signature_of(&s.state.borrow().statements[0].request);
    s.state.borrow_mut().cached.insert(format!("main:{signature}"));
    // The run stops while the cache retains the file
    let (open, gate) = oneshot();
    s.state.borrow_mut().retain_gate = Some(gate);
    let (handle, result) = s.start(&workbook, workbook_run());
    handle.cancel();
    open.send(());
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|failure| failure.kind), Some(RunFailureKind::Cancelled));
    let calls = s.state.borrow().calls.clone();
    assert!(calls.iter().any(|call| call == "retain 1"), "{calls:?}");
    assert_eq!(calls.last().map(String::as_str), Some("release 1"));
}

#[test]
fn runs_a_script_with_the_queries_it_inlines() {
    let main = connection("main", false);
    let workbook = workbook(&[
        ("setup.sql", "create table t as select 1 as x", &main),
        ("foo.sql", "select x from t", &main),
        ("bar.sql", "select count(*) from :foo", &main),
    ]);
    let s = setup(true, None, 1);
    let options = RunOptions { run: PlanRun::Script("bar.sql".into()), targets: Some(vec![2]), inputs: None, refresh: true, reports_state: false, analyze: true };
    let result = s.run(&workbook, options);
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["with foo as (\nselect x from t\n)\nselect count(*) from foo"]);
    let query = result.outputs.get(2).copied().flatten().unwrap();
    assert_eq!(workbook.borrow().script_by_file("bar.sql").unwrap().latest_query_id(), Some(query as u32));
    assert!(s.state.borrow().states.is_empty());
    // A script of the run that holds no statement fails the plan
    workbook.borrow_mut().add_stored_script("empty.sql", "", main.clone(), None).unwrap();
    let options = RunOptions { run: PlanRun::Script("empty.sql".into()), targets: Some(vec![3]), ..workbook_run() };
    let result = s.run(&workbook, options);
    let failure = result.failure.unwrap();
    assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Plan, "empty.sql holds no statement"));
    assert!(!result.launched);
}

#[test]
fn a_change_of_inputs_runs_the_scripts_it_affects() {
    let main = connection("main", false);
    let workbook = workbook(&[("a.sql", "/* @param :min = 3 */\nselect 1 where 2 > :min", &main), ("b.sql", "select 2", &main)]);
    let s = setup(true, None, 1);
    let options = RunOptions { inputs: Some(vec!["min".into()]), ..workbook_run() };
    let result = s.run(&workbook, options);
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["select 1 where 2 > 3"]);
    assert_eq!(s.last_state().total_scripts, 1);
    // A change that no script reads runs nothing
    let s = setup(true, None, 1);
    let options = RunOptions { inputs: Some(vec!["other".into()]), ..workbook_run() };
    assert!(s.run(&workbook, options).failure.is_none());
    assert!(s.texts().is_empty());
}

#[test]
fn skips_the_scripts_of_a_connection_that_can_not_run() {
    let (a, b) = (connection("a", false), connection("b", false));
    let workbook = workbook(&[("1_a.sql", "select 1", &a), ("2_b.sql", "select 2", &b)]);
    let s = setup(true, None, 1);
    s.state.borrow_mut().offline.insert("b".into());
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["select 1"]);
    assert_eq!(s.events("2_b.sql"), vec!["skipped"]);
    let state = s.last_state();
    assert_eq!((state.skipped_scripts, state.skipped_files.clone()), (1, vec!["2_b.sql".to_string()]));
}

#[test]
fn a_run_analyzes_only_the_scripts_with_outdated_analyses() {
    let main = connection("main", false);
    let workbook = workbook(&[("1_create.sql", "create table items (id int)", &main), ("2_query.sql", "select id from items", &main)]);
    let s = setup(true, None, 1);
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    let analyses = |workbook: &Rc<RefCell<Workbook>>| -> Vec<Option<(u64, u64, u64)>> {
        let workbook = workbook.borrow();
        workbook.scripts().iter().map(|s| s.editor_update().map(|u| (u.text_version, u.state_revision, u.catalog_revision))).collect()
    };
    let before = analyses(&workbook);
    assert!(before.iter().all(Option::is_some));
    // A second run, e.g. the one of an input change, analyzes nothing
    let options = RunOptions { refresh: true, ..workbook_run() };
    assert!(s.run(&workbook, options).failure.is_none());
    assert_eq!(analyses(&workbook), before);
    assert!(workbook.borrow().scripts().iter().all(|script| !script.is_analysis_outdated()));
}

/// A gated run of two scripts on one connection, the first statement runs
fn running_two_scripts(s: &Setup) -> (Rc<RefCell<Workbook>>, dashql_core_runtime::workbook_run::RunHandle<FakeHost>, Rc<RefCell<Option<RunResult>>>) {
    let main = connection("main", false);
    let workbook = workbook(&[("1_a.sql", "select 1", &main), ("2_b.sql", "select 2", &main)]);
    let (handle, result) = s.start(&workbook, workbook_run());
    assert_eq!(s.texts(), vec!["select 1"]);
    (workbook, handle, result)
}

#[test]
fn a_change_of_the_scripts_during_a_run_fails_it() {
    use dashql_core_runtime::workbook::WorkbookAction;
    // A rename, a delete and a move to another connection change the scripts of the plan
    let other = connection("other", false);
    let changes: Vec<(WorkbookAction, &str)> = vec![
        (WorkbookAction::RenameScript { file_name: "2_b.sql".into(), new_name: "2_c".into() }, "Workbook changed during execution"),
        (WorkbookAction::DeleteScript { file_name: "2_b.sql".into() }, "Workbook changed during execution"),
        (WorkbookAction::SetScriptConnection { file_name: "2_b.sql".into(), connection: other.clone() }, "Workbook script changed during execution: 2_b.sql"),
    ];
    for (action, message) in changes {
        let s = setup(false, None, 1);
        let (workbook, _handle, result) = running_two_scripts(&s);
        workbook.borrow_mut().apply(action).unwrap();
        s.end("select 1", Ok(true));
        let failure = result.borrow_mut().take().expect("the run ended").failure.expect("a failure");
        assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Error, message));
        assert_eq!(s.texts(), vec!["select 1"]);
    }
    // An edit of a planned script runs the statement as it was planned
    let s = setup(false, None, 1);
    let (workbook, _handle, result) = running_two_scripts(&s);
    let key = workbook.borrow().script_by_file("2_b.sql").unwrap().key();
    workbook.borrow_mut().apply(WorkbookAction::SetScriptText { key, text: "select 3".into(), with_diff: false }).unwrap();
    s.end("select 1", Ok(true));
    s.end("select 2", Ok(true));
    assert!(result.borrow_mut().take().expect("the run ended").failure.is_none());
    assert_eq!(s.texts(), vec!["select 1", "select 2"]);
}

#[test]
fn a_run_of_a_workbook_that_is_gone_fails() {
    let s = setup(false, None, 1);
    let (_workbook, _handle, result) = running_two_scripts(&s);
    s.host.live.set(false);
    s.end("select 1", Ok(true));
    let failure = result.borrow_mut().take().expect("the run ended").failure.expect("a failure");
    assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Error, "Workbook changed during execution"));
    assert_eq!(s.texts(), vec!["select 1"]);
}

/// A workbook whose first script has a cached result, the cache holds it
fn cached_workbook(s: &Setup) -> Rc<RefCell<Workbook>> {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main), ("bar.sql", "select a + 1 from :foo", &main)]);
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let signature = signature_of(&s.state.borrow().statements[0].request);
    let mut state = s.state.borrow_mut();
    state.statements.clear();
    state.calls.clear();
    state.events.clear();
    state.cached.insert(format!("main:{signature}"));
    drop(state);
    workbook
}

#[test]
fn runs_a_script_whose_cached_result_is_gone() {
    let s = setup(true, None, 1);
    let workbook = cached_workbook(&s);
    s.state.borrow_mut().missing = true;
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // The cached result was asked for, then the script ran with the one after it
    let statements = &s.state.borrow().statements;
    assert!(matches!(statements[0].request.cache, StatementCache::Only { .. }));
    assert_eq!(statements.len(), 3);
    assert!(statements.iter().skip(1).all(|s| matches!(s.request.cache, StatementCache::Refresh { .. })));
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("done"));
}

#[test]
fn cancels_a_run_that_serves_a_cached_result() {
    let s = setup(true, None, 1);
    let workbook = cached_workbook(&s);
    s.state.borrow_mut().gate_cached = true;
    let (handle, result) = s.start(&workbook, workbook_run());
    assert_eq!(s.state.borrow().statements.len(), 1);
    handle.cancel();
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|f| f.kind), Some(RunFailureKind::Cancelled));
    assert_eq!(s.state.borrow().statements.len(), 1);
    assert_eq!(s.last_state().phase, RunPhase::Cancelled);
}

#[test]
fn fails_a_run_whose_scripts_change_while_it_serves_cached_results() {
    let s = setup(true, None, 1);
    let workbook = cached_workbook(&s);
    s.state.borrow_mut().gate_cached = true;
    let (_handle, result) = s.start(&workbook, workbook_run());
    assert_eq!(s.texts(), vec!["select 1 as a"]);
    // The user types in bar while the run waits for the cached result of foo
    let bar = workbook.borrow().script_by_file("bar.sql").unwrap().key();
    let action = WorkbookAction::SetScriptText { key: bar, text: "select a + 2 from :foo".into(), with_diff: false };
    workbook.borrow_mut().apply(action).unwrap();
    s.end("select 1 as a", Ok(true));
    let result = result.borrow_mut().take().expect("the run ended");
    let failure = result.failure.expect("a failure");
    assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Error, "Workbook changed during execution"));
    // The new text of bar never ran under the key of the old one
    assert_eq!(s.texts(), vec!["select 1 as a"]);
}

#[test]
fn cancels_a_run_that_sets_up_its_connections() {
    let s = setup(true, None, 1);
    let main = connection("main", false);
    let workbook = workbook(&[("1_a.sql", "select 1", &main)]);
    let (release, gate) = oneshot();
    {
        let mut state = s.state.borrow_mut();
        state.prepares = true;
        state.prepare_gate = Some(gate);
    }
    let (handle, result) = s.start(&workbook, workbook_run());
    assert_eq!(s.state.borrow().calls, vec!["prepare main"]);
    handle.cancel();
    release.send(());
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|f| f.kind), Some(RunFailureKind::Cancelled));
    assert!(s.texts().is_empty());
}

#[test]
fn skips_the_scripts_of_a_connection_whose_setup_fails_during_a_run() {
    let (a, b) = (connection("a", false), connection("b", false));
    let workbook = workbook(&[("1_a.sql", "select 1", &a), ("2_b.sql", "select 2", &b)]);
    let s = setup(true, None, 1);
    {
        let mut state = s.state.borrow_mut();
        state.prepares = true;
        state.failing_setups.insert("b".into());
    }
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["select 1"]);
    assert_eq!(s.events("2_b.sql"), vec!["planned", "skipped"]);
    assert_eq!(s.last_state().skipped_files, vec!["2_b.sql".to_string()]);
}
