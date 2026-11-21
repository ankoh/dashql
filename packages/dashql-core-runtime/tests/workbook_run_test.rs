// The runs of workbooks on a fake host: an executor of a single thread and statements that the test answers, at once
// or when it releases them. The workbooks are real, the run analyzes and plans their scripts.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Wake, Waker};

use dashql_buffers::editor::EditorOffsetUnit;
use dashql_buffers::formatting::FormattingDialect;
use dashql_core_runtime::executor::{QueryId, StoredFile};
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_runtime::workbook::{
    new_catalog, ScriptConnection, ScriptConnectionProfile, Workbook, WorkbookAction, WorkbookEffect,
};
use dashql_core_runtime::workbook_run::{
    start_run, PlanRun, RetainedFile, RunFailureKind, RunHost, RunOptions, RunPhase, RunResult, RunState, ScriptEvent,
    StatementFailure, StatementHandle, StatementRequest, StatementResult,
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
    /// The keys of the stored results by script
    stored: BTreeMap<String, String>,
    /// The names of the stored files by script, `<script>.parquet` without one
    names: BTreeMap<String, String>,
    /// The generations of the files that the runs named
    generations: u32,
    /// The connections that can't run
    offline: BTreeSet<String>,
    /// The connections without a key of their results
    unkeyed: BTreeSet<String>,
    /// The texts of statements that fail
    failing: Vec<String>,
    /// How often the run told that it changed the workbook, and the effects it passed on
    changes: usize,
    effects: Vec<WorkbookEffect>,
    /// Do the statements that read stored results wait for the test?
    gate_cached: bool,
    /// Are the stored results gone when they are read?
    missing: bool,
    /// Does the host set up the connections of a run, the ones that fail, and a gate that the setups wait for
    prepares: bool,
    failing_setups: BTreeSet<String>,
    prepare_gate: Option<Receiver<()>>,
    /// Gates that the next retain of a stored file and the next pin wait for
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

    fn settings(&self) -> RuntimeSettings {
        RuntimeSettings::default()
    }
}

impl RunHost for FakeHost {
    fn execute(&self, request: StatementRequest) -> Result<StatementHandle, StatementFailure> {
        let query_id = self.next_query.get() + 1;
        self.next_query.set(query_id);
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("execute {}", request.text));
        let fails = state.failing.iter().any(|text| request.text.contains(text.as_str()));
        let cached = matches!(&request.result, StatementResult::Read { .. });
        let miss = cached && (state.missing || !state.stored.values().any(|key| *key == key_of(&request)));
        if (self.auto && !(cached && state.gate_cached)) || (cached && !state.gate_cached) {
            let end = if fails {
                Err(StatementFailure::new(format!("{} failed", request.text)))
            } else if miss {
                Err(StatementFailure { message: "miss".into(), cache_miss: true, value: None })
            } else {
                Ok(request.publish_results)
            };
            state.statements.push(Statement { query_id, request, done: None });
            return Ok(StatementHandle {
                query_id,
                ready: Box::pin(std::future::ready(())),
                done: Box::pin(std::future::ready(end)),
            });
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
        let keyed = !self.state.borrow().unkeyed.contains(connection_id);
        std::future::ready(keyed.then(|| format!("{connection_id}:{signature}")))
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
            if fails {
                Err(HostError::new("the setup failed"))
            } else {
                Ok(())
            }
        }
    }
    fn has_results(&self) -> bool {
        true
    }
    fn result_retain(&self, script: &str) -> impl Future<Output = Result<Option<RetainedFile>, HostError>> + 'static {
        let key = self.state.borrow().stored.get(script).cloned();
        let file = key.map(|key| RetainedFile {
            id: self.next_file(),
            file: StoredFile {
                name: self.state.borrow().names.get(script).cloned().unwrap_or_else(|| format!("{script}.parquet")),
                key,
                written_at: 1.0,
            },
        });
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
    fn result_release(&self, file: u64) -> impl Future<Output = ()> + 'static {
        self.state.borrow_mut().calls.push(format!("release {file}"));
        std::future::ready(())
    }
    fn mount_prefix(&self) -> Option<String> {
        self.mounts.clone()
    }
    fn mount_file_name(&self, result: Option<(&str, &str)>) -> String {
        let Some((script, _key)) = result else { return "transient.parquet".to_string() };
        let mut state = self.state.borrow_mut();
        state.generations += 1;
        format!("{script}.{}.parquet", state.generations)
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

/// The key of the stored result of a statement
fn key_of(request: &StatementRequest) -> String {
    match &request.result {
        StatementResult::Store { key, .. } => key.clone(),
        StatementResult::Read { file, .. } => file.key.clone(),
        StatementResult::None => String::new(),
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
    RunOptions {
        run: PlanRun::Workbook,
        targets: None,
        inputs: None,
        refresh: false,
        stored: false,
        reports_state: true,
        analyze: true,
    }
}

impl Setup {
    /// Start a run, the result lands in the returned cell
    fn start(
        &self,
        workbook: &Rc<RefCell<Workbook>>,
        options: RunOptions,
    ) -> (dashql_core_runtime::workbook_run::RunHandle<FakeHost>, Rc<RefCell<Option<RunResult>>>) {
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
        let sender = self
            .state
            .borrow_mut()
            .statements
            .iter_mut()
            .find(|s| s.request.text.contains(text))
            .and_then(|s| s.done.take());
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
    let query =
        s.state.borrow().statements.iter().find(|s| s.request.text.starts_with("select")).map(|s| s.query_id).unwrap();
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
    // A first run stores the results of the scripts
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let keys: Vec<String> = s.state.borrow().statements.iter().map(|s| key_of(&s.request)).collect();
    let scripts: Vec<String> = s
        .state
        .borrow()
        .statements
        .iter()
        .map(|s| match &s.request.result {
            StatementResult::Store { script, .. } => script.clone(),
            _ => String::new(),
        })
        .collect();
    assert_eq!(scripts, vec!["foo.sql", "bar.sql"]);
    assert_eq!(s.texts(), vec!["select 1 as a", "with foo as (\nselect 1 as a\n)\nselect a + 1 from foo"]);
    // The stored result of foo has its key, it is reused and bar runs
    s.state.borrow_mut().statements.clear();
    s.state.borrow_mut().stored.insert("foo.sql".into(), keys[0].clone());
    let second = s.run(&workbook, workbook_run());
    assert!(second.failure.is_none(), "{:?}", second.failure);
    let statements = &s.state.borrow().statements;
    assert!(
        matches!(statements[0].request.result, StatementResult::Read { .. }) && statements[0].request.planned.cached
    );
    assert!(matches!(statements[1].request.result, StatementResult::Store { .. }));
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("cached"));
}

/// The script, the key and the name of the file of every statement of the last runs that stores its result
fn stores(s: &Setup) -> Vec<(String, String, String)> {
    s.state
        .borrow()
        .statements
        .iter()
        .filter_map(|statement| match &statement.request.result {
            StatementResult::Store { script, key, name } => Some((script.clone(), key.clone(), name.clone())),
            _ => None,
        })
        .collect()
}

#[test]
fn a_new_result_of_a_script_is_a_new_key_of_the_scripts_downstream() {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main), ("bar.sql", "select a + 1 from :foo", &main)]);
    let s = setup(true, None, 1);
    // The key of bar covers the file that foo writes, the run named it when it planned
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let [(_, foo_key, foo_file), (_, bar_key, bar_file)] = <[_; 2]>::try_from(stores(&s)).unwrap();
    assert!(bar_key.ends_with(&format!("{foo_key} {foo_file}")), "{bar_key}");
    let store = |script: &str, key: &str, file: &str| {
        let mut state = s.state.borrow_mut();
        state.stored.insert(script.into(), key.into());
        state.names.insert(script.into(), file.into());
        state.statements.clear();
    };
    store("foo.sql", &foo_key, &foo_file);
    store("bar.sql", &bar_key, &bar_file);
    // Both results fit, a run reuses them
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert!(stores(&s).is_empty());
    // A refresh of foo writes a new file of the same key
    let refresh =
        RunOptions { run: PlanRun::Script("foo.sql".into()), targets: Some(vec![0]), refresh: true, ..workbook_run() };
    assert!(s.run(&workbook, refresh).failure.is_none());
    let [(_, refreshed_key, refreshed_file)] = <[_; 1]>::try_from(stores(&s)).unwrap();
    assert_eq!(refreshed_key, foo_key);
    assert_ne!(refreshed_file, foo_file);
    store("foo.sql", &refreshed_key, &refreshed_file);
    // foo reuses its new file, bar runs again: its result was computed from the old one
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("cached"));
    let [(script, key, _)] = <[_; 1]>::try_from(stores(&s)).unwrap();
    assert_eq!(script, "bar.sql");
    assert!(key.ends_with(&format!("{foo_key} {refreshed_file}")), "{key}");
}

#[test]
fn runs_a_script_whose_stored_result_has_another_key() {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main)]);
    let s = setup(true, None, 1);
    // A result of another version of the app or another login
    s.state.borrow_mut().stored.insert("foo.sql".into(), "other".into());
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let statements = &s.state.borrow().statements;
    assert_eq!(statements.len(), 1);
    assert!(matches!(&statements[0].request.result, StatementResult::Store { key, .. } if key.starts_with("main:")));
    // The file of the other key was released at once
    assert!(s.state.borrow().calls.iter().any(|call| call == "release 1"));
}

#[test]
fn an_opened_workbook_reads_the_stored_results_of_every_key_and_runs_nothing() {
    let main = connection("main", false);
    let workbook = workbook(&[
        ("foo.sql", "select 1 as a", &main),
        ("bar.sql", "select 2", &main),
        ("baz.sql", "select 3", &main),
        // A script with an error shows its stored result too, the plan is tolerant
        ("broken.sql", "select * from :missing", &main),
    ]);
    let s = setup(true, None, 1);
    {
        let mut state = s.state.borrow_mut();
        state.stored.insert("foo.sql".into(), "outdated".into());
        state.stored.insert("bar.sql".into(), "main:anything".into());
        state.stored.insert("broken.sql".into(), "main:anything".into());
        // Reading needs no connection
        state.offline.insert("main".into());
    }
    let options = RunOptions { stored: true, ..workbook_run() };
    let result = s.run(&workbook, options);
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let statements = &s.state.borrow().statements;
    assert_eq!(statements.len(), 3);
    assert!(statements.iter().all(|s| matches!(s.request.result, StatementResult::Read { .. })));
    assert_eq!(result.outputs.iter().map(Option::is_some).collect::<Vec<_>>(), vec![true, true, false, true]);
    // A read is neither a reuse by a run nor a skip
    for file in ["foo.sql", "bar.sql", "baz.sql", "broken.sql"] {
        assert_eq!(s.events(file), Vec::<String>::new(), "{file}");
    }
    // The read reports its progress over the scripts that it reads, the planned ones that show no result yet
    let states = s.state.borrow().states.clone();
    assert!(states.iter().any(|state| state.phase == RunPhase::Running && state.completed_scripts < 4));
    let last = s.last_state();
    assert_eq!((last.phase, last.completed_scripts, last.total_scripts), (RunPhase::Succeeded, 4, 4));
    assert_eq!((last.skipped_scripts, last.total_statements), (0, 0));
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
    assert_eq!(calls.get(1).map(String::as_str), Some("pin 1 /mnt/cache/foo.sql.1.parquet"));
    assert_eq!(calls.get(2).map(String::as_str), Some("write 1 /mnt/cache/foo.sql.1.parquet"));
    assert!(calls
        .get(3)
        .is_some_and(|call| call.starts_with("execute") && call.contains("/mnt/cache/foo.sql.1.parquet")));
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
    // A result without a key is a transient file of the run
    s.state.borrow_mut().unkeyed.insert("remote".to_string());
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
    assert!(s.state.borrow().calls.iter().any(|call| call == "pin 1 /mnt/cache/foo.sql.1.parquet"));
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
    // A first run learns the key of the result of foo, the result is stored then
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let key = key_of(&s.state.borrow().statements[0].request);
    s.state.borrow_mut().stored.insert("foo.sql".into(), key);
    // The run stops while it retains the file
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
    let options = RunOptions {
        run: PlanRun::Script("bar.sql".into()),
        targets: Some(vec![2]),
        inputs: None,
        refresh: true,
        stored: false,
        reports_state: false,
        analyze: true,
    };
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
    let workbook =
        workbook(&[("a.sql", "/* @param :min = 3 */\nselect 1 where 2 > :min", &main), ("b.sql", "select 2", &main)]);
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
    let workbook = workbook(&[
        ("1_create.sql", "create table items (id int)", &main),
        ("2_query.sql", "select id from items", &main),
    ]);
    let s = setup(true, None, 1);
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    let analyses = |workbook: &Rc<RefCell<Workbook>>| -> Vec<Option<(u64, u64, u64)>> {
        let workbook = workbook.borrow();
        workbook
            .scripts()
            .iter()
            .map(|s| s.editor_update().map(|u| (u.text_version, u.state_revision, u.catalog_revision)))
            .collect()
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
fn running_two_scripts(
    s: &Setup,
) -> (Rc<RefCell<Workbook>>, dashql_core_runtime::workbook_run::RunHandle<FakeHost>, Rc<RefCell<Option<RunResult>>>) {
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
        (
            WorkbookAction::RenameScript { file_name: "2_b.sql".into(), new_name: "2_c".into() },
            "Workbook changed during execution",
        ),
        (WorkbookAction::DeleteScript { file_name: "2_b.sql".into() }, "Workbook changed during execution"),
        (
            WorkbookAction::SetScriptConnection { file_name: "2_b.sql".into(), connection: other.clone() },
            "Workbook script changed during execution: 2_b.sql",
        ),
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
    workbook
        .borrow_mut()
        .apply(WorkbookAction::SetScriptText { key, text: "select 3".into(), with_diff: false })
        .unwrap();
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

/// A workbook whose first script has a stored result of its key
fn cached_workbook(s: &Setup) -> Rc<RefCell<Workbook>> {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main), ("bar.sql", "select a + 1 from :foo", &main)]);
    let first = s.run(&workbook, workbook_run());
    assert!(first.failure.is_none(), "{:?}", first.failure);
    let key = key_of(&s.state.borrow().statements[0].request);
    let mut state = s.state.borrow_mut();
    state.statements.clear();
    state.calls.clear();
    state.events.clear();
    state.stored.insert("foo.sql".into(), key);
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
    // The stored result was asked for, then the script ran with the one after it
    let statements = &s.state.borrow().statements;
    assert!(matches!(statements[0].request.result, StatementResult::Read { .. }));
    assert_eq!(statements.len(), 3);
    assert!(statements.iter().skip(1).all(|s| matches!(s.request.result, StatementResult::Store { .. })));
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
