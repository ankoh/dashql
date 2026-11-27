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
    new_catalog, RunPlanRequest, ScriptConnection, ScriptConnectionProfile, Workbook, WorkbookAction, WorkbookEffect,
};
use dashql_core_runtime::workbook_run::result_key::{stored_result_keys, UNMATCHED_RESULT_KEY};
use dashql_core_runtime::workbook_run::{
    start_run, PlanRun, RetainedFile, RunFailureKind, RunHost, RunOptions, RunPhase, RunResult, RunState, RunStep,
    ScriptEvent, ScriptFailure, StatementFailure, StatementHandle, StatementRequest, StatementResult,
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
    /// Ends the statement in a gated test
    done: Option<Sender<Result<bool, StatementFailure>>>,
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
    /// Does the workbook store no results? Its scripts have no keys then.
    without_results: bool,
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
            return Ok(StatementHandle { query_id, done: Box::pin(std::future::ready(end)) });
        }
        let (sender, receiver) = oneshot();
        state.statements.push(Statement { query_id, request, done: Some(sender) });
        Ok(StatementHandle {
            query_id,
            done: Box::pin(async move { receiver.await.unwrap_or_else(|| Err(StatementFailure::new("dropped"))) }),
        })
    }

    fn cancel(&self, _connection_id: &str, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        let mut state = self.state.borrow_mut();
        state.calls.push(format!("cancel {query_id}"));
        let sender = state.statements.iter_mut().find(|s| s.query_id == query_id).and_then(|s| s.done.take());
        if let Some(sender) = sender {
            sender.send(Err(StatementFailure::new("Query was cancelled")));
        }
        std::future::ready(())
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
        !self.state.borrow().without_results
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
            ScriptEvent::Blocked { .. } => "blocked",
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
        local: false,
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

    /// The query of the statement with a text
    fn query_of(&self, text: &str) -> QueryId {
        self.state.borrow().statements.iter().find(|s| s.request.text == text).map(|s| s.query_id).expect("a statement")
    }

    fn calls(&self) -> Vec<String> {
        self.state.borrow().calls.clone()
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
        let done = sender.expect("a running statement");
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
    assert!(statements[2].request.planned.title().starts_with("3_query.sql"));
}

/// The id and the path of a pin of the call log
fn pin_of(call: &str) -> (String, String) {
    let (id, path) = call.strip_prefix("pin ").and_then(|pin| pin.split_once(' ')).expect("a pin with a path");
    (id.to_string(), path.to_string())
}

#[test]
fn a_failed_statement_fails_its_script_and_the_others_run_on() {
    let (a, b) = (connection("a", false), connection("b", false));
    let workbook = workbook(&[("1_a.sql", "select 1", &a), ("2_b.sql", "select 2", &b)]);
    let s = setup(false, None, 1);
    let (_handle, result) = s.start(&workbook, workbook_run());
    // The statements of the two connections run at once
    assert_eq!(s.texts(), vec!["select 1", "select 2"]);
    s.end("select 1", Err(StatementFailure::new("boom")));
    // The other script is no follower of the failed one, it runs on
    assert!(result.borrow().is_none(), "the run waits for select 2");
    let cancel = format!("cancel {}", s.query_of("select 2"));
    assert!(!s.calls().contains(&cancel), "{:?}", s.calls());
    s.end("select 2", Ok(true));
    let result = result.borrow_mut().take().expect("the run ended");
    let failure = result.failure.expect("a failure");
    assert_eq!((failure.kind, failure.message.as_str()), (RunFailureKind::Error, "boom"));
    assert_eq!(s.events("1_a.sql"), vec!["planned", "started", "failed"]);
    assert_eq!(s.events("2_b.sql"), vec!["planned", "started", "done"]);
    let state = s.last_state();
    assert_eq!((state.phase, state.error.as_deref()), (RunPhase::Failed, Some("boom")));
    assert_eq!(state.completed_scripts, 1);
    assert_eq!(state.failed, vec![ScriptFailure { file: "1_a.sql".into(), message: "boom".into() }]);
}

#[test]
fn the_scripts_that_follow_a_failed_script_do_not_run() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[
        ("foo.sql", "select 1 as a", &remote),
        ("bar.sql", "select count(*) from :foo", &local),
        ("baz.sql", "select 3", &local),
    ]);
    let s = setup(true, Some("/mnt/cache"), 1);
    s.state.borrow_mut().failing.push("select 1 as a".into());
    let result = s.run(&workbook, workbook_run());
    assert_eq!(result.failure.map(|f| f.message), Some("select 1 as a failed".to_string()));
    // bar scans the result of foo, it never runs and says why; baz runs
    assert!(!s.texts().iter().any(|text| text.contains("count(*)")), "{:?}", s.texts());
    assert!(s.texts().contains(&"select 3".to_string()), "{:?}", s.texts());
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("failed"));
    assert_eq!(s.events("bar.sql").last().map(String::as_str), Some("blocked"));
    assert_eq!(s.events("baz.sql").last().map(String::as_str), Some("done"));
    let state = s.last_state();
    assert_eq!((state.phase, state.completed_scripts, state.failed.len()), (RunPhase::Failed, 1, 1));
    // The run wrote no file of foo and released its pins
    assert!(!s.calls().iter().any(|call| call.starts_with("write ")), "{:?}", s.calls());
}

#[test]
fn execute_all_fails_the_scripts_it_can_not_plan_and_runs_the_others() {
    let main = connection("main", false);
    let workbook = workbook(&[
        ("good.sql", "select 1", &main),
        ("broken.sql", "select * from :missing", &main),
        ("other.sql", "select 2", &main),
    ]);
    let s = setup(true, None, 1);
    let result = s.run(&workbook, workbook_run());
    let failure = result.failure.expect("a failure");
    assert_eq!(failure.kind, RunFailureKind::Plan);
    assert!(failure.message.contains("missing"), "{}", failure.message);
    assert_eq!(s.texts(), vec!["select 1", "select 2"]);
    assert_eq!(s.events("broken.sql"), vec!["failed"]);
    let state = s.last_state();
    assert_eq!(state.phase, RunPhase::Failed);
    assert_eq!(state.failed.iter().map(|f| f.file.as_str()).collect::<Vec<_>>(), vec!["broken.sql"]);
    assert_eq!((state.completed_scripts, state.skipped_scripts), (2, 0));
    // A run of the script itself still needs all of its plan
    let script = RunOptions { run: PlanRun::Script("broken.sql".into()), targets: Some(vec![1]), ..workbook_run() };
    let failure = s.run(&workbook, script).failure.expect("a failure");
    assert_eq!(failure.kind, RunFailureKind::Plan);
}

#[test]
fn a_run_of_a_script_scans_the_stored_result_of_a_script_of_another_connection() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        // An imported result: its key matches no script
        let mut state = s.state.borrow_mut();
        state.stored.insert("foo.sql".into(), "imported".into());
        state.names.insert("foo.sql".into(), "foo.sql.imported.1.parquet".into());
    }
    let run_bar = |refresh: bool| RunOptions {
        run: PlanRun::Script("bar.sql".into()),
        targets: Some(vec![1]),
        refresh,
        ..workbook_run()
    };
    let result = s.run(&workbook, run_bar(false));
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // foo doesn't run on its connection, it shows its stored file and bar scans the file
    let runs_foo =
        |s: &Setup| {
            s.state.borrow().statements.iter().any(|st| {
                st.request.text == "select 1 as a" && !matches!(st.request.result, StatementResult::Read { .. })
            })
        };
    assert!(!runs_foo(&s), "{:?}", s.texts());
    assert!(s.texts().iter().any(|text| text.contains("/mnt/cache/foo.sql.imported.1.parquet")), "{:?}", s.texts());
    // A refresh runs foo
    s.state.borrow_mut().statements.clear();
    let result = s.run(&workbook, run_bar(true));
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert!(runs_foo(&s), "{:?}", s.texts());
}

#[test]
fn a_run_reads_no_stored_result_that_its_script_shows_already() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        let mut state = s.state.borrow_mut();
        state.offline.insert("remote".into());
        state.stored.insert("foo.sql".into(), "imported".into());
        state.names.insert("foo.sql".into(), "foo.sql.imported.1.parquet".into());
    }
    let reads = |s: &Setup| {
        s.state
            .borrow()
            .statements
            .iter()
            .filter(|st| matches!(st.request.result, StatementResult::Read { .. }))
            .count()
    };
    // The first run reads the file of foo to show it
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert_eq!(reads(&s), 1);
    let shown = workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_query_id());
    assert_eq!(
        workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_file().map(str::to_string)),
        Some("foo.sql.imported.1.parquet".to_string())
    );
    // The next run reuses the file without reading it again, bar still scans it
    s.state.borrow_mut().statements.clear();
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert_eq!(reads(&s), 0, "{:?}", s.texts());
    assert!(s.texts().iter().any(|text| text.contains("/mnt/cache/foo.sql.imported.1.parquet")), "{:?}", s.texts());
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("cached"));
    assert_eq!(workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_query_id()), shown);
    // A new file of foo is read again
    s.state.borrow_mut().names.insert("foo.sql".into(), "foo.sql.imported.2.parquet".into());
    s.state.borrow_mut().statements.clear();
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert_eq!(reads(&s), 1);
}

#[test]
fn a_run_shows_the_stored_result_again_after_a_failure_took_its_place() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        let mut state = s.state.borrow_mut();
        state.offline.insert("remote".into());
        state.stored.insert("foo.sql".into(), "imported".into());
        state.names.insert("foo.sql".into(), "foo.sql.imported.1.parquet".into());
    }
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    let latest = || workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_query_id());
    let shown =
        workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_query_id()).expect("shown");
    assert_eq!(latest(), Some(shown));
    // A refresh without the connection failed, the card shows its error
    let key = workbook.borrow().script_by_file("foo.sql").map(|script| script.key()).unwrap();
    workbook.borrow_mut().apply(WorkbookAction::RegisterQuery { key, query_id: shown + 100 }).unwrap();
    // The next run shows the result of the file again without reading it
    s.state.borrow_mut().statements.clear();
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    assert!(!s.state.borrow().statements.iter().any(|st| matches!(st.request.result, StatementResult::Read { .. })));
    assert_eq!(latest(), Some(shown));
}

#[test]
fn a_script_remembers_the_stored_file_of_the_result_it_wrote() {
    let main = connection("main", false);
    let workbook = workbook(&[("foo.sql", "select 1 as a", &main)]);
    let s = setup(true, None, 1);
    assert!(s.run(&workbook, workbook_run()).failure.is_none());
    let [(_, _, name)] = <[_; 1]>::try_from(stores(&s)).unwrap();
    let file =
        workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_file().map(str::to_string));
    assert_eq!(file, Some(name));
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
    let cancel = format!("cancel {}", s.query_of("select 2"));
    assert!(s.calls().contains(&cancel), "{:?}", s.calls());
    assert!(s.state.borrow().states.iter().any(|state| state.phase == RunPhase::Stopping));
    assert_eq!(s.last_state().phase, RunPhase::Cancelled);
}

#[test]
fn a_stop_stops_the_analyses_of_the_results_of_the_run() {
    let main = connection("main", false);
    let workbook = workbook(&[("1_a.sql", "select 1", &main), ("2_b.sql", "select 2", &main)]);
    let s = setup(false, None, 1);
    let (handle, result) = s.start(&workbook, workbook_run());
    // The first script is done once its result is there, the analysis of its result may still run
    s.end("select 1", Ok(true));
    assert_eq!(s.events("1_a.sql"), vec!["planned", "started", "done"]);
    let first = format!("cancel {}", s.query_of("select 1"));
    assert!(!s.calls().contains(&first), "{:?}", s.calls());
    handle.cancel();
    s.executor.run_until_stalled();
    assert!(result.borrow().is_some());
    // The stop cancels the running statement and the query of the result whose analysis may still run
    let second = format!("cancel {}", s.query_of("select 2"));
    assert!(s.calls().contains(&first) && s.calls().contains(&second), "{:?}", s.calls());
}

#[test]
fn a_failed_run_leaves_the_analyses_of_its_results_alone() {
    let main = connection("main", false);
    let workbook = workbook(&[("1_a.sql", "select 1", &main), ("2_b.sql", "select 2", &main)]);
    let s = setup(false, None, 1);
    let (_handle, result) = s.start(&workbook, workbook_run());
    s.end("select 1", Ok(true));
    s.end("select 2", Err(StatementFailure::new("select 2 failed")));
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|f| f.kind), Some(RunFailureKind::Error));
    let first = format!("cancel {}", s.query_of("select 1"));
    assert!(!s.calls().contains(&first), "{:?}", s.calls());
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
    // bar inlines the query of foo, the planner snapshots pin how
    let texts = s.texts();
    assert_eq!(texts[0], "select 1 as a");
    assert!(texts[1].contains("with foo as") && texts[1].ends_with("from foo"), "{}", texts[1]);
    // The stored result of foo has its key, it is reused and bar runs
    s.state.borrow_mut().statements.clear();
    s.state.borrow_mut().states.clear();
    s.state.borrow_mut().stored.insert("foo.sql".into(), keys[0].clone());
    let second = s.run(&workbook, workbook_run());
    assert!(second.failure.is_none(), "{:?}", second.failure);
    // The state names the steps before the statements run: the analysis, the plan, the lookups and the reads of the
    // stored results, the plan that scans them
    let mut steps: Vec<Option<RunStep>> = s.state.borrow().states.iter().map(|state| state.step.clone()).collect();
    steps.dedup();
    let file = |name: &str| name.to_string();
    assert_eq!(
        steps,
        vec![
            Some(RunStep::Analyzing),
            Some(RunStep::Planning),
            Some(RunStep::Checking { file: file("foo.sql") }),
            Some(RunStep::Reading { file: file("foo.sql") }),
            Some(RunStep::Checking { file: file("bar.sql") }),
            Some(RunStep::Planning),
            None,
        ]
    );
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
    assert_ne!(key, bar_key);
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
    assert!(matches!(&statements[0].request.result, StatementResult::Store { key, .. } if key.len() == 64));
    // The file of the other key was released at once
    assert!(s.calls().iter().any(|call| call.starts_with("release ")), "{:?}", s.calls());
}

#[test]
fn a_shown_workbook_reads_the_stored_results_of_every_key_of_the_connections_that_can_not_run() {
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
        // Only the embedded Hyper runs
        state.offline.insert("main".into());
    }
    let result = s.run(&workbook, RunOptions { local: true, ..workbook_run() });
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let statements = &s.state.borrow().statements;
    assert_eq!(statements.len(), 3);
    assert!(statements.iter().all(|s| matches!(s.request.result, StatementResult::Read { .. })));
    // The scripts whose stored keys are reusable reuse them, the others show them all the same
    assert_eq!(s.events("foo.sql"), vec!["cached"]);
    assert_eq!(s.events("bar.sql"), vec!["cached"]);
    let shown: Vec<bool> = ["foo.sql", "bar.sql", "baz.sql", "broken.sql"]
        .iter()
        .map(|file| {
            statements
                .iter()
                .any(|s| matches!(&s.request.result, StatementResult::Read { script, .. } if script == file))
        })
        .collect();
    assert_eq!(shown, vec![true, true, false, true]);
    // The scripts that don't run are done, they need no connection
    let last = s.last_state();
    assert_eq!((last.phase, last.completed_scripts, last.total_scripts), (RunPhase::Succeeded, 4, 4));
    assert_eq!((last.skipped_scripts, last.total_statements), (0, 0));
}

/// A connection with the client functions of a made-up service
fn connection_with_client_functions(id: &str, local: bool) -> Rc<ScriptConnection> {
    let mut catalog = new_catalog();
    let spec = r#"{
        "format": 1,
        "namespace": "t",
        "hosts": { "api": { "base_path": "/v1" } },
        "errors": { "message": ["/message"] },
        "functions": [
            { "name": "list", "method": "GET", "host": "api", "path": "/items" },
            { "name": "create", "method": "POST", "effect": "write", "host": "api", "path": "/items" }
        ]
    }"#;
    catalog.register_client_functions(spec).unwrap();
    let profile = ScriptConnectionProfile {
        dialect: FormattingDialect::HYPER,
        local,
        params: None,
        default_database: String::new(),
        default_schema: String::new(),
    };
    Rc::new(ScriptConnection::new(id, Rc::new(RefCell::new(catalog)), profile))
}

#[test]
fn a_shown_workbook_runs_on_the_embedded_hyper_and_calls_no_client_function() {
    let (local, remote) = (connection_with_client_functions("local", true), connection("remote", false));
    let workbook = workbook(&[
        ("remote.sql", "select 1 as a", &remote),
        ("post.sql", "select count(*) from :remote", &local),
        ("call.sql", "call t.list()", &local),
        ("after.sql", "select * from :call", &local),
    ]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        let mut state = s.state.borrow_mut();
        state.offline.insert("remote".into());
        // An imported result of the remote script, and the last result of the call
        state.stored.insert("remote.sql".into(), "imported".into());
        state.names.insert("remote.sql".into(), "remote.sql.imported.1.parquet".into());
        state.stored.insert("call.sql".into(), "earlier".into());
    }
    let result = s.run(&workbook, RunOptions { local: true, ..workbook_run() });
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // The remote script shows its imported result, the embedded Hyper post-processes it and stores its result
    assert_eq!(s.events("remote.sql"), vec!["cached"]);
    assert!(s.texts().iter().any(|text| text.contains("/mnt/cache/remote.sql.imported.1.parquet")), "{:?}", s.texts());
    assert!(stores(&s).iter().any(|(script, _, _)| script == "post.sql"), "{:?}", stores(&s));
    // The call doesn't run but shows its stored result, the script after it is left out
    assert_eq!(s.events("call.sql"), vec!["skipped"]);
    assert_eq!(s.events("after.sql"), vec!["skipped"]);
    let statements = &s.state.borrow().statements;
    assert!(statements.iter().all(|s| s.request.client_function_call.is_none()));
    let calls: Vec<&Statement> = statements.iter().filter(|s| s.request.text.contains("call")).collect();
    assert_eq!(calls.len(), 1);
    assert!(matches!(calls[0].request.result, StatementResult::Read { .. }));
    let last = s.last_state();
    assert_eq!((last.phase, last.completed_scripts, last.total_scripts), (RunPhase::Succeeded, 4, 4));
    assert_eq!(last.skipped_scripts, 0);
}

#[test]
fn a_shown_workbook_runs_no_script_that_runs_only_on_request() {
    let local = connection("local", true);
    let workbook = workbook(&[("manual.sql", "/* @manual */\nselect 1", &local), ("auto.sql", "select 2", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    s.state.borrow_mut().stored.insert("manual.sql".into(), "earlier".into());
    let result = s.run(&workbook, RunOptions { local: true, ..workbook_run() });
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // The manual script shows its stored result, the other one runs
    assert_eq!(s.events("manual.sql"), vec!["skipped"]);
    let statements = &s.state.borrow().statements;
    let reads: Vec<bool> =
        statements.iter().map(|s| matches!(s.request.result, StatementResult::Read { .. })).collect();
    assert_eq!(reads, vec![true, false], "{:?}", s.texts());
    assert!(statements[1].request.text.contains("select 2"));
}

#[test]
fn execute_all_calls_the_client_functions_that_a_shown_workbook_leaves_out() {
    let local = connection_with_client_functions("local", true);
    let workbook = workbook(&[("call.sql", "call t.list()", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let statements = &s.state.borrow().statements;
    assert_eq!(statements.len(), 1);
    assert!(statements[0].request.client_function_call.is_some());
}

#[test]
fn execute_all_holds_back_the_scripts_that_run_only_on_request() {
    let local = connection_with_client_functions("local", true);
    // A call is a barrier, the scripts after the write would follow it
    let workbook = workbook(&[
        ("read.sql", "call t.list()", &local),
        ("manual.sql", "/* @manual */\nselect 1 as a", &local),
        ("west.sql", "select count(*) from :manual", &local),
        ("write.sql", "call t.create()", &local),
    ]);
    let s = setup(true, Some("/mnt/cache"), 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // The manual script and the write don't run, the read runs and the reference inlines the manual script
    assert_eq!(s.events("manual.sql"), vec!["skipped"]);
    assert_eq!(s.events("write.sql"), vec!["skipped"]);
    let statements = &s.state.borrow().statements;
    let calls: Vec<&str> = statements
        .iter()
        .filter(|s| s.request.client_function_call.is_some())
        .map(|s| s.request.text.as_str())
        .collect();
    assert_eq!(calls, vec!["call t.list()"], "{:?}", s.texts());
    assert!(statements.iter().any(|s| s.request.text.contains("select 1")), "{:?}", s.texts());
    // The scripts that the run holds back are done, they need no connection
    let last = s.last_state();
    assert_eq!((last.phase, last.completed_scripts, last.total_scripts), (RunPhase::Succeeded, 4, 4));
    assert_eq!(last.skipped_scripts, 0);
}

/// The scripts whose stored results the last runs read
fn reads(s: &Setup) -> Vec<String> {
    s.state
        .borrow()
        .statements
        .iter()
        .filter_map(|statement| match &statement.request.result {
            StatementResult::Read { script, .. } => Some(script.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_shown_workbook_whose_run_fails_shows_the_stored_results_of_the_scripts_it_did_not_finish() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[
        ("a.sql", "select 1", &local),
        ("b.sql", "select 2 as x", &remote),
        ("c.sql", "select count(*) from :b", &local),
    ]);
    let s = setup(false, Some("/mnt/cache"), 1);
    for script in ["a.sql", "b.sql", "c.sql"] {
        // Results of earlier texts, the scripts run
        s.state.borrow_mut().stored.insert(script.into(), "earlier".into());
    }
    let (_handle, result) = s.start(&workbook, RunOptions { local: true, ..workbook_run() });
    s.end("select 1", Ok(true));
    s.end("select 2 as x", Err(StatementFailure::new("boom")));
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|failure| failure.message), Some("boom".to_string()));
    // a shows its new result and b its error, c follows b, never ran and shows its stored result
    assert_eq!(s.events("c.sql").last().map(String::as_str), Some("blocked"));
    assert_eq!(reads(&s), vec!["c.sql"]);
    let workbook = workbook.borrow();
    let c = workbook.script_by_file("c.sql").unwrap();
    assert!(c.latest_result_query_id().is_some());
    // The run released every file that it retained
    let calls = s.calls();
    let retained = calls.iter().filter(|call| call.starts_with("retain ")).count();
    let released = calls.iter().filter(|call| call.starts_with("release ")).count();
    assert!(retained > 0 && released >= retained, "{calls:?}");
}

#[test]
fn a_shown_workbook_that_is_stopped_shows_the_stored_results_of_the_scripts_it_did_not_finish() {
    let local = connection("local", true);
    let workbook = workbook(&[("a.sql", "select 1", &local), ("b.sql", "select 2", &local)]);
    let s = setup(false, Some("/mnt/cache"), 1);
    for script in ["a.sql", "b.sql"] {
        s.state.borrow_mut().stored.insert(script.into(), "earlier".into());
    }
    let (handle, result) = s.start(&workbook, RunOptions { local: true, ..workbook_run() });
    assert_eq!(s.texts(), vec!["select 1"]);
    handle.cancel();
    s.executor.run_until_stalled();
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|failure| failure.kind), Some(RunFailureKind::Cancelled));
    // The stopped script and the one that never started show their stored results
    assert_eq!(reads(&s), vec!["a.sql", "b.sql"]);
    assert_eq!(s.last_state().phase, RunPhase::Cancelled);
}

#[test]
fn a_shown_workbook_whose_read_of_a_stored_result_fails_shows_the_stored_results_of_the_other_scripts() {
    let local = connection("local", true);
    let workbook = workbook(&[("manual.sql", "/* @manual */\nselect 1", &local), ("auto.sql", "select 2", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        let mut state = s.state.borrow_mut();
        state.stored.insert("manual.sql".into(), "earlier".into());
        state.stored.insert("auto.sql".into(), "earlier".into());
        // The file of the manual script is broken, its read fails before auto runs
        state.failing.push("select 1".into());
    }
    let result = s.run(&workbook, RunOptions { local: true, ..workbook_run() });
    let failure = result.failure.expect("a failure");
    assert!(failure.message.ends_with("select 1 failed"), "{}", failure.message);
    // The manual script shows its error and is read once, auto shows its stored result
    assert_eq!(reads(&s), vec!["manual.sql", "auto.sql"]);
}

#[test]
fn execute_all_that_fails_reads_no_stored_results() {
    let local = connection("local", true);
    let workbook = workbook(&[("a.sql", "select 1", &local), ("b.sql", "select 2", &local)]);
    let s = setup(false, Some("/mnt/cache"), 1);
    for script in ["a.sql", "b.sql"] {
        s.state.borrow_mut().stored.insert(script.into(), "earlier".into());
    }
    let (_handle, result) = s.start(&workbook, workbook_run());
    s.end("select 1", Err(StatementFailure::new("boom")));
    s.end("select 2", Ok(true));
    assert!(result.borrow_mut().take().expect("the run ended").failure.is_some());
    assert!(reads(&s).is_empty());
}

/// Poll a future on the executor of a test until it stalls, its output
fn block_on<T: 'static>(s: &Setup, future: impl Future<Output = T> + 'static) -> T {
    let slot = Rc::new(RefCell::new(None));
    let output = slot.clone();
    s.executor.spawn(Box::pin(async move {
        *output.borrow_mut() = Some(future.await);
    }));
    s.executor.run_until_stalled();
    let value = slot.borrow_mut().take();
    value.expect("the future is ready")
}

#[test]
fn the_lookup_keys_the_scripts_downstream_of_a_connection_that_can_not_run_like_a_run() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook =
        workbook(&[("orders.sql", "select 1 as a", &remote), ("top.sql", "select count(*) from :orders", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    // An imported result of orders, its connection can't run
    let orders = StoredFile {
        name: format!("orders.{UNMATCHED_RESULT_KEY}.1.parquet"),
        key: UNMATCHED_RESULT_KEY.to_string(),
        written_at: 1.0,
    };
    {
        let mut state = s.state.borrow_mut();
        state.offline.insert("remote".into());
        state.stored.insert("orders.sql".into(), orders.key.clone());
        state.names.insert("orders.sql".into(), orders.name.clone());
    }
    // The run of the shown workbook computes top over the file of orders
    let result = s.run(&workbook, RunOptions { local: true, ..workbook_run() });
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let [(script, top_key, top_name)] = <[_; 1]>::try_from(stores(&s)).unwrap();
    assert_eq!(script, "top.sql");
    let top = StoredFile { name: top_name, key: top_key.clone(), written_at: 2.0 };
    // The lookup over the listing of the folder
    let graph = workbook
        .borrow()
        .plan_run(&RunPlanRequest { mount_prefix: "/mnt/external/dashql-keys", ..RunPlanRequest::default() });
    let files = vec![Some(orders.clone()), Some(top.clone())];
    let lookup = |online: bool| {
        let files = files.clone();
        let graph = graph.clone();
        block_on(&s, async move { stored_result_keys(&graph, |script| online || script != 0, &files).await })
    };
    let keys = lookup(false);
    let (orders_key, top_key_now) = (keys[0].clone().unwrap(), keys[1].clone().unwrap());
    // top is current, orders is outdated: the key of its file stands in for it only in the runs
    assert_eq!(top_key_now.key, top_key);
    assert_eq!(top_key_now.script_key(), top_key);
    assert_eq!(orders_key.key, UNMATCHED_RESULT_KEY);
    assert_ne!(orders_key.script_key(), UNMATCHED_RESULT_KEY);
    // A run of top alone reuses its result
    s.state.borrow_mut().stored.insert("top.sql".into(), top.key.clone());
    s.state.borrow_mut().names.insert("top.sql".into(), top.name.clone());
    s.state.borrow_mut().statements.clear();
    let run = RunOptions { run: PlanRun::Script("top.sql".into()), targets: Some(vec![1]), ..workbook_run() };
    assert!(s.run(&workbook, run).failure.is_none());
    assert_eq!(s.events("top.sql").last().map(String::as_str), Some("cached"));
    assert!(stores(&s).is_empty(), "{:?}", stores(&s));
    // Once orders can run, Execute All runs it and top: both are outdated
    let keys = lookup(true);
    assert_ne!(keys[0].clone().unwrap().script_key(), UNMATCHED_RESULT_KEY);
    assert_ne!(keys[1].clone().unwrap().script_key(), top_key);
}

#[test]
fn materializes_a_script_of_another_connection_before_the_scan() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let calls = s.calls();
    assert_eq!(calls.first().map(String::as_str), Some("execute select 1 as a"));
    // The run pins the file of foo before it writes it, the scan reads it, the pin goes once the run ended
    let at = |found: &dyn Fn(&str) -> bool| calls.iter().position(|call| found(call)).expect("a call");
    let pin = at(&|call| call.starts_with("pin "));
    let (pin_id, path) = pin_of(&calls[pin]);
    assert!(path.starts_with("/mnt/cache/foo.sql"), "{path}");
    let write = at(&|call| call.starts_with("write ") && call.ends_with(&path));
    let scan = at(&|call| call.starts_with("execute") && call.contains(&path));
    assert!(pin < write && write < scan, "{calls:?}");
    assert_eq!(calls.last(), Some(&format!("release {pin_id}")));
    // foo remembers the file that its result was written to
    let file =
        workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_file().map(str::to_string));
    assert_eq!(file.map(|file| format!("/mnt/cache/{file}")), Some(path.clone()));
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
    s.state.borrow_mut().without_results = true;
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let calls = s.calls();
    let pin = calls.iter().find(|call| call.starts_with("pin ")).expect("a pin");
    let (pin_id, path) = pin_of(pin);
    assert!(path.ends_with("/transient.parquet"), "{path}");
    // The file goes after its pin, at the end of the run
    let release = calls.iter().position(|call| *call == format!("release {pin_id}")).expect("a release");
    let remove = calls.iter().position(|call| call == "remove transient.parquet").expect("a removal");
    assert!(release < remove, "{calls:?}");
    assert_eq!(remove, calls.len() - 1, "{calls:?}");
    // A transient file is no stored file of the result
    let file =
        workbook.borrow().script_by_file("foo.sql").and_then(|script| script.latest_result_file().map(str::to_string));
    assert_eq!(file, None);
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
    let calls = s.calls();
    let pin = calls.iter().find(|call| call.starts_with("pin ") && call.contains("/mnt/cache/foo.sql")).expect("a pin");
    let (pin_id, _) = pin_of(pin);
    s.end("select 2", Err(StatementFailure::new("boom")));
    // The run waits for the statement of foo before it releases the files, bar runs on once the file is written
    assert!(result.borrow().is_none());
    open.send(());
    s.executor.run_until_stalled();
    s.end("count(*)", Ok(true));
    let result = result.borrow_mut().take().expect("the run ended");
    assert_eq!(result.failure.map(|failure| failure.message), Some("boom".to_string()));
    assert_eq!(s.calls().last(), Some(&format!("release {pin_id}")));
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
    let calls = s.calls();
    let retained = calls.iter().find_map(|call| call.strip_prefix("retain ")).expect("a retained file");
    assert_eq!(calls.last(), Some(&format!("release {retained}")), "{calls:?}");
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
        local: false,
        reports_state: false,
        analyze: true,
    };
    let result = s.run(&workbook, options);
    assert!(result.failure.is_none(), "{:?}", result.failure);
    let texts = s.texts();
    assert_eq!(texts.len(), 1);
    assert!(texts[0].contains("with foo as") && texts[0].ends_with("select count(*) from foo"), "{}", texts[0]);
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
fn a_script_of_a_connection_that_can_not_run_uses_its_stored_result_of_any_key() {
    let (local, remote) = (connection("local", true), connection("remote", false));
    let workbook = workbook(&[("foo.sql", "select 1 as a", &remote), ("bar.sql", "select count(*) from :foo", &local)]);
    let s = setup(true, Some("/mnt/cache"), 1);
    {
        // A result of another version of the keys or an imported one
        let mut state = s.state.borrow_mut();
        state.offline.insert("remote".into());
        state.stored.insert("foo.sql".into(), "other".into());
        state.names.insert("foo.sql".into(), "foo.sql.other.1.parquet".into());
    }
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // foo is read from its file, bar scans the file and stores its result
    assert_eq!(s.events("foo.sql").last().map(String::as_str), Some("cached"));
    let [(script, _, _)] = <[_; 1]>::try_from(stores(&s)).unwrap();
    assert_eq!(script, "bar.sql");
    assert!(s.texts().iter().any(|text| text.contains("/mnt/cache/foo.sql.other.1.parquet")), "{:?}", s.texts());
    assert_eq!(s.last_state().skipped_scripts, 0);
    // Every file that the run retained is released
    let calls = s.calls();
    let retained = calls.iter().filter(|call| call.starts_with("retain ")).count();
    let released = calls.iter().filter(|call| call.starts_with("release ")).count();
    assert!(retained > 0 && released >= retained, "{calls:?}");
}

#[test]
fn a_refresh_skips_the_scripts_of_a_connection_that_can_not_run() {
    let (a, b) = (connection("a", false), connection("b", false));
    let workbook = workbook(&[("1_a.sql", "select 1", &a), ("2_b.sql", "select 2", &b)]);
    let s = setup(true, None, 1);
    {
        let mut state = s.state.borrow_mut();
        state.offline.insert("b".into());
        state.stored.insert("2_b.sql".into(), "other".into());
    }
    let result = s.run(&workbook, RunOptions { refresh: true, ..workbook_run() });
    assert!(result.failure.is_none(), "{:?}", result.failure);
    assert_eq!(s.texts(), vec!["select 1"]);
    assert_eq!(s.events("2_b.sql"), vec!["skipped"]);
    // Without the refresh the stored result of the other key is shown
    s.state.borrow_mut().statements.clear();
    let result = s.run(&workbook, workbook_run());
    assert!(result.failure.is_none(), "{:?}", result.failure);
    // The stored result is read while the run settles its keys, before 1_a runs
    assert_eq!(s.texts(), vec!["select 2", "select 1"]);
    assert_eq!(s.events("2_b.sql").last().map(String::as_str), Some("cached"));
    assert_eq!(s.last_state().skipped_scripts, 0);
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
