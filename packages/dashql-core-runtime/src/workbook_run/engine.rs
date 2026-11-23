//! The task of a run, see the module documentation.
//!
//! The run holds the workbook behind a `RefCell` and borrows it only between its awaits. It tells the host about a
//! change of the workbook after the borrow ended, so the host may read the workbook from `workbook_changed`. The
//! statements of a plan settle in tasks of the host, they release the nodes that follow them and wake the run.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::task::{Context, Poll};

use dashql_buffers::execution::ExecutionGraphT;

use super::plan::{
    affected_scripts, describe_plan_errors, edges, nodes, planned_statements, script_follows, skipped_nodes,
    visualization_is_valid, PlanRun, PlannedStatement, NONE,
};
use super::result_key::{result_keys, run_key, ResultKey};
use super::{
    RunFailure, RunFailureKind, RunHost, RunOptions, RunPhase, RunResult, RunState, ScriptEvent, StatementRequest,
    StatementResult,
};
use crate::executor::{QueryId, StoredFile};
use crate::host::signal::{oneshot, Sender};
use crate::host::LogLevel;
use crate::workbook::{RunPlanRequest, ScriptKey, ScriptVisualization, SessionHandle, Workbook, WorkbookAction};

/// The statements that settle between two yields to the host
const EXECUTION_YIELD_INTERVAL: usize = 8;

/// A query that runs, by its id
struct ActiveQuery {
    connection_id: String,
    /// Was it asked to stop?
    cancelling: bool,
}

/// What the run and the tasks of its statements share
struct Control {
    /// Was the run cancelled?
    cancelled: Cell<bool>,
    /// Did the run end?
    finished: Cell<bool>,
    /// The queries that run
    active: RefCell<BTreeMap<QueryId, ActiveQuery>>,
    /// Wakes the run, it waits for a statement or a task
    waker: RefCell<Option<Sender<()>>>,
    /// Was the run woken while it didn't wait?
    woken: Cell<bool>,
    /// The tasks of the host that run for the run, the statements and the cancellations
    pending: Cell<usize>,
}

impl Control {
    fn wake(&self) {
        self.woken.set(true);
        let waker = self.waker.borrow_mut().take();
        if let Some(waker) = waker {
            waker.send(());
        }
    }

    async fn wait(&self) {
        if !self.woken.replace(false) {
            let (sender, receiver) = oneshot();
            *self.waker.borrow_mut() = Some(sender);
            receiver.await;
            self.woken.set(false);
        }
    }
}

/// The scheduling state of a plan that runs
struct Schedule {
    /// The unfinished predecessors of the nodes
    predecessors: Vec<usize>,
    /// The nodes that are ready, in node order
    ready: Vec<usize>,
    /// The statements that run, by connection index
    running: Vec<usize>,
    running_total: usize,
    /// The nodes whose successors were released
    released: Vec<bool>,
    /// The first failure, it stops the run
    failure: Option<RunFailure>,
    /// The queries of the last outputs of the scripts
    outputs: Vec<Option<QueryId>>,
    /// The settled statements of the scripts
    settled: Vec<usize>,
    /// The settled statements of the run, for the yields to the host
    settled_total: usize,
    /// The scripts that started and those that ended, each reported once
    started: BTreeSet<u32>,
    ended: BTreeSet<u32>,
}

/// What the statements of a plan read
struct PlanContext {
    graph: ExecutionGraphT,
    /// The connection ids of the plan, `node.connection` indexes them
    connection_ids: Vec<String>,
    /// The statements of every node
    statements: Vec<PlannedStatement>,
    /// The nodes of every script
    nodes_of_script: Vec<Vec<usize>>,
    /// The node of the last output of every script
    output_nodes: Vec<Option<usize>>,
    /// The successors of every node, every pair once
    successors: Vec<Vec<usize>>,
    /// The visualization of every node that produces output
    visualizations: Vec<Option<ScriptVisualization>>,
    /// The result keys of the scripts
    keys: Vec<Option<ResultKey>>,
    /// The names of the new files of the scripts that run, the keys downstream of them cover the names
    names: BTreeMap<u32, String>,
    /// The scripts whose results the plan materializes, the files of the scripts already
    materialized: BTreeSet<u32>,
    /// The nodes that don't run
    skip: BTreeSet<u32>,
}

impl PlanContext {
    /// The key of a script that a done script reports: the reusable key of a script with a result node
    fn done_key(&self, script: u32) -> Option<String> {
        let has_result = nodes(&self.graph).iter().any(|node| node.script == script && node.script_result);
        self.keys.get(script as usize).cloned().flatten().filter(|key| key.reusable && has_result).map(|key| key.key)
    }
}

/// What a run settled about the results of its scripts while it derived their keys
#[derive(Default)]
struct Settled {
    /// The scripts that may run, by feed index: not a script that reused its result, nor one of a connection that
    /// can't run
    runs: Vec<bool>,
    /// The scripts that reused their stored results, with their files
    cached: BTreeMap<u32, String>,
    /// The names of the new files of the scripts that run
    names: BTreeMap<u32, String>,
    /// Why the run stopped while it reused a result, e.g. a cancel
    failure: Option<RunFailure>,
}

/// The plan whose results a run settles
struct Settling<'a> {
    graph: &'a ExecutionGraphT,
    statements: &'a [PlannedStatement],
    visualizations: &'a [Option<ScriptVisualization>],
    /// The scripts that every script follows
    follows: &'a [BTreeSet<u32>],
    /// May the scripts reuse their stored results?
    reuse: bool,
    /// The scripts that a run of a shown workbook holds back, they keep their stored files
    held: &'a BTreeSet<u32>,
    settled: &'a RefCell<Settled>,
}

/// A run of a workbook
struct Run<H: RunHost> {
    host: Rc<H>,
    workbook: Rc<RefCell<Workbook>>,
    options: RunOptions,
    control: Rc<Control>,
    workbook_id: String,
    /// The files, keys, sessions and connections of the scripts when the run started, in feed order
    files: Vec<String>,
    keys: Vec<ScriptKey>,
    sessions: Vec<SessionHandle>,
    connections: Vec<String>,
    state: RefCell<RunState>,
    /// Did the run hand a statement to the host?
    launched: Cell<bool>,
    /// The files that the run keeps until it settled, by the ids of the host: the stored files that it retained and the
    /// pins of the files that it scans and writes
    kept: RefCell<Vec<u64>>,
    /// The transient files of the results that the run materializes, removed once it released its files
    transient: RefCell<Vec<String>>,
    /// The schedule of the plan that runs
    schedule: RefCell<Option<Schedule>>,
    /// The first plan of a run of a shown workbook: a run that fails or stops reads the stored results of the scripts
    /// that it didn't finish over it
    shown: RefCell<Option<ExecutionGraphT>>,
    /// The scripts that ran to their end or failed, also in a read of their stored results. A stopped script is none.
    finished: RefCell<BTreeSet<u32>>,
}

/// A run that started. Dropping the handle doesn't stop the run.
pub struct RunHandle<H: RunHost> {
    run: Rc<Run<H>>,
}

impl<H: RunHost> RunHandle<H> {
    /// Stop the run: the running statements are cancelled, the run settles once they are done
    pub fn cancel(&self) {
        let run = &self.run;
        if run.control.finished.get() || run.control.cancelled.replace(true) {
            return;
        }
        run.emit(|state| state.phase = RunPhase::Stopping);
        run.cancel_active();
        run.control.wake();
    }
}

/// Start a run of the scripts of a workbook. The returned future runs it, the handle stops it.
pub fn start_run<H: RunHost>(
    host: Rc<H>,
    workbook: Rc<RefCell<Workbook>>,
    options: RunOptions,
) -> (RunHandle<H>, impl Future<Output = RunResult> + 'static) {
    let (workbook_id, files, keys, sessions, connections) = match workbook.try_borrow() {
        Ok(workbook) => (
            workbook.id().to_string(),
            workbook.scripts().iter().map(|script| script.file_name().to_string()).collect(),
            workbook.scripts().iter().map(|script| script.key()).collect(),
            workbook.scripts().iter().map(|script| script.session().clone()).collect(),
            workbook.scripts().iter().map(|script| script.connection().connection_id.clone()).collect(),
        ),
        Err(_) => (String::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()),
    };
    let control = Rc::new(Control {
        cancelled: Cell::new(false),
        finished: Cell::new(false),
        active: RefCell::new(BTreeMap::new()),
        waker: RefCell::new(None),
        woken: Cell::new(false),
        pending: Cell::new(0),
    });
    let run = Rc::new(Run {
        host,
        workbook,
        options,
        control,
        workbook_id,
        files,
        keys,
        sessions,
        connections,
        state: RefCell::new(RunState::default()),
        launched: Cell::new(false),
        kept: RefCell::new(Vec::new()),
        transient: RefCell::new(Vec::new()),
        schedule: RefCell::new(None),
        shown: RefCell::new(None),
        finished: RefCell::new(BTreeSet::new()),
    });
    let handle = RunHandle { run: run.clone() };
    (handle, async move { run.execute().await })
}

/// The details of a log message
type Details = Vec<(String, String)>;

fn detail(key: &str, value: impl Into<String>) -> (String, String) {
    (key.to_string(), value.into())
}

/// A unique mount prefix of a plan without the mounts of the results of the workbook. Its materializations can't run, the
/// plan fails if it has any.
fn unique_mount_prefix(now: f64) -> String {
    thread_local! {
        static NEXT: Cell<u64> = const { Cell::new(0) };
    }
    let next = NEXT.with(|next| {
        let value = next.get() + 1;
        next.set(value);
        value
    });
    format!("/mnt/external/dashql-run-{}-{next}", now as u64)
}

/// Waits for every future of a list
struct JoinAll<T> {
    futures: Vec<Option<Pin<Box<dyn Future<Output = T>>>>>,
    results: Vec<Option<T>>,
}

impl<T: Unpin> Future for JoinAll<T> {
    type Output = Vec<T>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Vec<T>> {
        let this = self.get_mut();
        let mut pending = false;
        for (future, result) in this.futures.iter_mut().zip(this.results.iter_mut()) {
            if let Some(f) = future {
                match f.as_mut().poll(cx) {
                    Poll::Ready(value) => {
                        *result = Some(value);
                        *future = None;
                    }
                    Poll::Pending => pending = true,
                }
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(this.results.iter_mut().filter_map(Option::take).collect())
        }
    }
}

fn join_all<T>(futures: Vec<Pin<Box<dyn Future<Output = T>>>>) -> JoinAll<T> {
    let results = futures.iter().map(|_| None).collect();
    JoinAll { futures: futures.into_iter().map(Some).collect(), results }
}

impl<H: RunHost> Run<H> {
    fn log(&self, level: LogLevel, message: &str, details: Details) {
        let details: Vec<(&str, &str)> = details.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        self.host.log(level, message, &details);
    }

    /// Change the state and report it
    fn emit(&self, change: impl FnOnce(&mut RunState)) {
        if !self.options.reports_state {
            return;
        }
        let state = {
            let mut state = self.state.borrow_mut();
            change(&mut state);
            state.clone()
        };
        self.host.state(&state);
    }

    fn file(&self, script: u32) -> String {
        self.files.get(script as usize).cloned().unwrap_or_else(|| format!("script {script}"))
    }

    fn connection_of(&self, script: u32) -> &str {
        self.connections.get(script as usize).map(String::as_str).unwrap_or_default()
    }

    fn check_cancelled(&self) -> Result<(), RunFailure> {
        if self.control.cancelled.get() {
            Err(RunFailure::cancelled())
        } else {
            Ok(())
        }
    }

    /// Yield to the host, a cancelled run stops
    async fn cooperate(&self) -> Result<(), RunFailure> {
        self.check_cancelled()?;
        self.host.cooperate().await;
        self.check_cancelled()
    }

    /// Apply an action to the workbook and tell the host, with the effects of the action. A failed action fails the
    /// run.
    fn apply(&self, action: WorkbookAction) -> Result<(), RunFailure> {
        let outcome = {
            let mut workbook = self.workbook.try_borrow_mut().map_err(|_| RunFailure::error("The workbook is busy"))?;
            workbook.apply(action).map_err(|error| RunFailure::error(error.message))?
        };
        if outcome.changed || !outcome.effects.is_empty() {
            self.host.workbook_changed(outcome.effects, false);
        }
        Ok(())
    }

    /// Run a task of the host for the run, the run settles once its tasks are done
    fn spawn(&self, task: impl Future<Output = ()> + 'static) {
        let control = self.control.clone();
        control.pending.set(control.pending.get() + 1);
        self.host.spawn(Box::pin(async move {
            task.await;
            control.pending.set(control.pending.get().saturating_sub(1));
            control.wake();
        }));
    }

    /// Wait for the tasks of the run
    async fn settle(&self) {
        while self.control.pending.get() > 0 {
            self.control.wait().await;
        }
    }

    /// Cancel the queries that run
    fn cancel_active(&self) {
        let cancels: Vec<(String, QueryId)> = {
            let mut active = self.control.active.borrow_mut();
            active
                .iter_mut()
                .filter(|(_, query)| !query.cancelling)
                .map(|(id, query)| {
                    query.cancelling = true;
                    (query.connection_id.clone(), *id)
                })
                .collect()
        };
        for (connection_id, query_id) in cancels {
            let cancel = self.host.cancel(&connection_id, query_id);
            self.spawn(cancel);
        }
    }

    /// Check that the workbook keeps its scripts, their order and their sessions. With the versions, the planned
    /// scripts keep the text of the plan. The catalog may move on, the plan holds the statements as written and the
    /// catalog follows them while they run.
    fn validate(&self, graph: &ExecutionGraphT, versions: bool) -> Result<(), RunFailure> {
        let changed = || RunFailure::error("Workbook changed during execution");
        if !self.host.workbook_live() {
            return Err(changed());
        }
        let workbook = self.workbook.try_borrow().map_err(|_| changed())?;
        let scripts = workbook.scripts();
        if scripts.len() != self.files.len()
            || scripts.iter().zip(&self.files).any(|(script, file)| script.file_name() != file)
        {
            return Err(changed());
        }
        for (index, script) in scripts.iter().enumerate() {
            let same = self.keys.get(index) == Some(&script.key())
                && self.sessions.get(index).is_some_and(|session| Rc::ptr_eq(session, script.session()));
            if !same {
                return Err(RunFailure::error(format!(
                    "Workbook script changed during execution: {}",
                    self.file(index as u32)
                )));
            }
        }
        let planned = graph.scripts.as_deref().unwrap_or_default();
        if planned.len() != scripts.len() {
            return Err(changed());
        }
        if !versions {
            return Ok(());
        }
        for (index, (metadata, script)) in planned.iter().zip(scripts).enumerate() {
            if !metadata.planned {
                continue;
            }
            let text_version = script.session().try_borrow().map(|session| session.text_version()).ok();
            if metadata.script_id != script.key()
                || Some(metadata.text_version) != text_version
                || metadata.analyzed_text_version != metadata.text_version
            {
                return Err(RunFailure::error(format!("Stale execution plan: {}", self.file(index as u32))));
            }
        }
        Ok(())
    }

    /// Plan the scripts. A catalog update may have landed since the preparation, the scripts with outdated analyses
    /// analyze first.
    fn plan(
        &self,
        targets: Option<&[u32]>,
        provided: &[u32],
        files: &[(u32, String)],
        mount_prefix: &str,
    ) -> Result<ExecutionGraphT, RunFailure> {
        let busy = || RunFailure::error("The workbook is busy");
        let analyzed = self.workbook.try_borrow_mut().map_err(|_| busy())?.analyze_outdated_scripts();
        if analyzed {
            self.host.workbook_changed(Vec::new(), true);
        }
        // A run of a shown workbook plans what it can, a script that can't be planned leaves the others alone
        let tolerant = self.options.local;
        let request =
            RunPlanRequest { targets, materialized: provided, mount_prefix, materialization_files: files, tolerant };
        let graph = self.workbook.try_borrow().map_err(|_| busy())?.plan_run(&request);
        if !graph.valid && !tolerant {
            return Err(RunFailure::plan(describe_plan_errors(&graph, &self.files)));
        }
        Ok(graph)
    }

    /// The visualizations of the outputs of a plan, they must decode, also those of outputs that the run discards. A run
    /// of a shown workbook holds back the scripts whose visualizations don't decode instead.
    fn visualizations(&self, graph: &ExecutionGraphT) -> Result<Vec<Option<ScriptVisualization>>, RunFailure> {
        let (visualizations, invalid) = Self::decoded_visualizations(graph);
        if !invalid.is_empty() && !self.options.local {
            return Err(RunFailure::error("Invalid captured visualization metadata"));
        }
        Ok(visualizations)
    }

    /// The visualizations of the outputs of a plan and the scripts with a visualization that doesn't decode
    fn decoded_visualizations(graph: &ExecutionGraphT) -> (Vec<Option<ScriptVisualization>>, BTreeSet<u32>) {
        let mut invalid = BTreeSet::new();
        let visualizations = nodes(graph)
            .iter()
            .map(|node| match (&node.visualization, node.produces_output) {
                (Some(visualization), true) if visualization_is_valid(visualization) => Some(ScriptVisualization {
                    sql: node.sql.clone().unwrap_or_default(),
                    statement_id: node.statement_id,
                    visualization: (**visualization).clone(),
                }),
                (Some(_), true) => {
                    invalid.insert(node.script);
                    None
                }
                _ => None,
            })
            .collect();
        (visualizations, invalid)
    }

    /// The key of a script for the run (`run_key`), none without stored results. A script of a connection that can't
    /// run takes the key of its stored file, whatever key the script has now, the lookup of the stored results derives
    /// the keys the same way (`stored_result_keys`). The file stays retained until the run released its files. A
    /// refresh reuses nothing and keeps the key.
    fn key_of(self: &Rc<Self>) -> impl Fn(u32, String) -> Pin<Box<dyn Future<Output = Option<String>>>> {
        let run = self.clone();
        move |script, key| {
            let run = run.clone();
            Box::pin(async move {
                if !run.host.has_results() {
                    return None;
                }
                let connection = run.connection_of(script);
                if run.options.refresh || run.host.can_run(connection) {
                    return Some(key);
                }
                let Some(retained) = run.host.result_retain(&run.file(script)).await.ok().flatten() else {
                    return Some(key);
                };
                run.kept.borrow_mut().push(retained.id);
                if key != retained.file.key {
                    run.log(
                        LogLevel::Info,
                        "A script whose connection can't run uses its stored result of another key",
                        vec![
                            detail("workbookId", run.workbook_id.clone()),
                            detail("script", run.file(script)),
                            detail("key", key.clone()),
                            detail("storedKey", retained.file.key.clone()),
                        ],
                    );
                }
                Some(run_key(key, false, Some(&retained.file.key)))
            })
        }
    }

    /// The result keys of the scripts of a plan that runs and what the run does with their results, in the order of
    /// their references: a script whose key is reusable and matches its stored file reuses it unless it follows a
    /// script that runs, every other script with a result node writes a new file under a name that the run gives it
    /// now, and a script without one keeps its stored file, e.g. a script that another one inlines. The keys
    /// downstream of a script cover its file.
    async fn settle_results(
        self: &Rc<Self>,
        graph: &ExecutionGraphT,
        visualizations: &[Option<ScriptVisualization>],
        held: &BTreeSet<u32>,
    ) -> Result<(Vec<Option<ResultKey>>, Settled), RunFailure> {
        let count = self.files.len();
        let statements = planned_statements(graph, &self.files, &self.options.run);
        let follows = script_follows(graph, count);
        // A script of a connection that can't run doesn't run, nor does a script that is held back, the scripts that
        // follow it reuse their stored results: the script can't change what they read during the run
        let settled = RefCell::new(Settled {
            runs: self
                .connections
                .iter()
                .enumerate()
                .map(|(script, connection)| self.host.can_run(connection) && !held.contains(&(script as u32)))
                .collect(),
            ..Settled::default()
        });
        let plan = Settling {
            graph,
            statements: &statements,
            visualizations,
            follows: &follows,
            reuse: !self.options.refresh && self.host.has_results(),
            held,
            settled: &settled,
        };
        let keys = result_keys(graph, self.key_of(), |script, key| self.settle_result(&plan, script, key)).await;
        let mut settled = settled.into_inner();
        match settled.failure.take() {
            Some(failure) => Err(failure),
            None => Ok((keys, settled)),
        }
    }

    /// Settle the result of a script of a plan that runs, the name of its file for the keys downstream of it
    async fn settle_result(self: &Rc<Self>, plan: &Settling<'_>, script: u32, key: ResultKey) -> Option<String> {
        if plan.settled.borrow().failure.is_some() {
            return None;
        }
        let result_node = nodes(plan.graph).iter().position(|node| node.script == script && node.script_result);
        let Some(result_node) = result_node.filter(|_| !plan.held.contains(&script)) else {
            return self.keep_stored(script).await;
        };
        let blocked = plan.follows.get(script as usize).is_some_and(|earlier| {
            let settled = plan.settled.borrow();
            earlier.iter().any(|e| settled.runs.get(*e as usize) == Some(&true))
        });
        if plan.reuse && key.reusable && !blocked {
            match self.reuse_stored(plan, script, result_node, &key).await {
                Ok(Some(name)) => return Some(name),
                Ok(None) => {}
                Err(failure) => {
                    plan.settled.borrow_mut().failure = Some(failure);
                    return None;
                }
            }
        }
        // The script runs, its result becomes a new file
        let name = self.host.mount_file_name(Some((self.file(script).as_str(), key.key.as_str())));
        plan.settled.borrow_mut().names.insert(script, name.clone());
        Some(name)
    }

    /// Reuse the stored result of a script if its file has the key, the name of the file or none if the script runs
    async fn reuse_stored(
        self: &Rc<Self>,
        plan: &Settling<'_>,
        script: u32,
        result_node: usize,
        key: &ResultKey,
    ) -> Result<Option<String>, RunFailure> {
        let host = self.host.clone();
        let file = self.file(script);
        let retained = host.result_retain(&file).await.ok().flatten();
        // A file of another key is no result of the script as it is now, the script runs
        let retained = match retained {
            Some(retained) if retained.file.key != key.key => {
                host.result_release(retained.id).await;
                None
            }
            retained => retained,
        };
        // A file that was retained is kept before a cancellation counts, the release of the run releases it
        if let Some(retained) = &retained {
            self.kept.borrow_mut().push(retained.id);
        }
        self.check_cancelled()?;
        let Some(retained) = retained else { return Ok(None) };
        let Some(served) = self
            .serve_cached(plan.graph, script, result_node, &retained.file, plan.statements, plan.visualizations)
            .await?
        else {
            return Ok(None);
        };
        {
            let mut settled = plan.settled.borrow_mut();
            if let Some(run) = settled.runs.get_mut(script as usize) {
                *run = false;
            }
            settled.cached.insert(script, retained.file.name.clone());
        }
        self.host.script_event(&file, &ScriptEvent::Cached { key: key.key.clone(), query_id: served });
        self.cooperate().await?;
        Ok(Some(retained.file.name))
    }

    /// Keep the stored file of a script until the run settled, its name or none without one
    async fn keep_stored(self: &Rc<Self>, script: u32) -> Option<String> {
        if !self.host.has_results() {
            return None;
        }
        let retained = self.host.result_retain(&self.file(script)).await.ok().flatten()?;
        self.kept.borrow_mut().push(retained.id);
        Some(retained.file.name)
    }

    /// Run the workbook and report how it ended
    async fn execute(self: Rc<Self>) -> RunResult {
        let mut result = self.run_plan().await;
        if result.is_ok() && self.control.cancelled.get() {
            result = Err(RunFailure::cancelled());
        }
        let outcome = match result {
            Ok(outputs) => {
                // The run of a script shows the last output of the script
                if let (PlanRun::Script(_), Some([target])) = (&self.options.run, self.options.targets.as_deref()) {
                    if let (Some(Some(query_id)), Some(key)) =
                        (outputs.get(*target as usize), self.keys.get(*target as usize))
                    {
                        if let Err(failure) =
                            self.apply(WorkbookAction::RegisterQuery { key: *key, query_id: *query_id as u32 })
                        {
                            self.log(
                                LogLevel::Warn,
                                "Failed to register the result of the run",
                                vec![detail("error", failure.message)],
                            );
                        }
                    }
                }
                self.emit(|state| {
                    state.phase = RunPhase::Succeeded;
                    state.active_file_name = None;
                    state.active_statement_index = None;
                    state.active_statement_count = None;
                });
                RunResult { outputs, failure: None, launched: self.launched.get() }
            }
            Err(failure) => {
                self.cancel_active();
                self.settle().await;
                let cancelled = self.control.cancelled.get() || failure.kind == RunFailureKind::Cancelled;
                self.emit(|state| {
                    state.phase = if cancelled { RunPhase::Cancelled } else { RunPhase::Failed };
                    state.error = (!cancelled).then(|| failure.message.clone());
                });
                let failure =
                    if cancelled { RunFailure { kind: RunFailureKind::Cancelled, ..failure } } else { failure };
                RunResult {
                    outputs: vec![None; self.files.len()],
                    failure: Some(failure),
                    launched: self.launched.get(),
                }
            }
        };
        self.control.finished.set(true);
        outcome
    }

    /// Run the plan, then release the files of the run. A plan that failed cancels the statements that run and waits
    /// for them first, a statement never writes a file past the release of its pin.
    async fn run_plan(self: &Rc<Self>) -> Result<Vec<Option<QueryId>>, RunFailure> {
        let result = self.plan_and_run().await;
        if result.is_err() {
            self.cancel_active();
            self.settle().await;
            self.read_unfinished().await;
        }
        self.release_files().await;
        result
    }

    /// A run of a shown workbook that failed or stopped shows the stored results of the scripts that it didn't finish: a
    /// script that failed shows its error and one that ran to its end its result, every other script reads its stored
    /// result if it shows none yet. The reads after a Stop run to their end, a Stop during the reads after a failure
    /// stops them.
    async fn read_unfinished(self: &Rc<Self>) {
        let Some(graph) = self.shown.borrow_mut().take() else { return };
        let finished = self.finished.borrow().clone();
        let scripts: Vec<u32> = (0..self.files.len() as u32).filter(|script| !finished.contains(script)).collect();
        let stoppable = !self.control.cancelled.get();
        if let Err(failure) = self.read_stored(&graph, &scripts, stoppable).await {
            self.log(
                LogLevel::Info,
                "Reading the stored results of the scripts that the run didn't finish stopped",
                vec![detail("workbookId", self.workbook_id.clone()), detail("error", failure.message)],
            );
        }
    }

    /// Pin a file below the mount prefix until the run released its files
    async fn pin(&self, path: &str) -> Result<(), RunFailure> {
        let pin = self.host.mount_pin(path).await.map_err(|error| RunFailure::from_host(&error))?;
        self.kept.borrow_mut().push(pin);
        Ok(())
    }

    /// Release the files that the run kept, then remove its transient files, which nobody pins any more
    async fn release_files(&self) {
        let kept = std::mem::take(&mut *self.kept.borrow_mut());
        for file in kept {
            self.host.result_release(file).await;
        }
        let transient = std::mem::take(&mut *self.transient.borrow_mut());
        for name in transient {
            self.host.mount_remove(&name).await;
        }
    }

    /// Analyze the scripts, plan the targets with what they need, every script without targets, reuse the stored
    /// results whose keys match and run the rest.
    ///
    /// A script whose stored result has its reusable key doesn't run if no script runs that it follows in the plan: its
    /// result is read from its file, a script that scans it reads the file. A refresh reuses no results. A script that
    /// runs replaces its stored result. Returns the queries of the outputs of the scripts.
    async fn plan_and_run(self: &Rc<Self>) -> Result<Vec<Option<QueryId>>, RunFailure> {
        let host = self.host.clone();
        let count = self.files.len();
        self.emit(|state| state.total_scripts = count);
        // Let the host paint the running state before the analysis and the planning
        self.cooperate().await?;
        let mut offline: Vec<&str> = Vec::new();
        for connection in &self.connections {
            if !host.can_run(connection) && !offline.contains(&connection.as_str()) {
                offline.push(connection);
            }
        }
        if !offline.is_empty() {
            let details = vec![
                detail("workbookId", self.workbook_id.clone()),
                detail("connections", offline.join(", ")),
                detail("refresh", self.options.refresh.to_string()),
                detail("results", host.has_results().to_string()),
            ];
            if self.options.refresh || !host.has_results() {
                self.log(LogLevel::Warn, "Running without connections, their scripts reuse no results", details);
            } else {
                self.log(
                    LogLevel::Info,
                    "Running without connections, their scripts use their stored results",
                    details,
                );
            }
        }
        // The scripts with outdated analyses analyze, a slider that changes an input reruns without analyzing the rest
        let prepared =
            self.workbook.try_borrow_mut().map_err(|_| RunFailure::error("The workbook is busy"))?.analyze_for_run();
        if prepared != Ok(false) {
            host.workbook_changed(Vec::new(), true);
        }
        // A run of a shown workbook leaves a script that doesn't analyze out of its plan
        if !self.options.local {
            prepared.map_err(RunFailure::error)?;
        }
        self.cooperate().await?;

        // A change of inputs runs the scripts that it affects, with what they read
        let mut targets = self.options.targets.clone();
        if let Some(inputs) = &self.options.inputs {
            let dataflow =
                self.workbook.try_borrow().map_err(|_| RunFailure::error("The workbook is busy"))?.dataflow();
            let affected = affected_scripts(&dataflow, inputs);
            let total = affected.len();
            self.emit(|state| state.total_scripts = total);
            if affected.is_empty() {
                return Ok(vec![None; count]);
            }
            targets = Some(affected);
        }
        let mount_prefix = host.mount_prefix().unwrap_or_else(|| unique_mount_prefix(host.now()));
        // The plan of the targets checks the workbook and gives the result keys
        let mut graph = self.plan(targets.as_deref(), &[], &[], &mount_prefix)?;
        if self.options.local {
            *self.shown.borrow_mut() = Some(graph.clone());
        }
        // A run of a shown workbook calls no client function and holds back the scripts that run only on request and
        // those whose visualizations don't decode: its tolerant plan has them all
        let mut held_back: BTreeMap<u32, &'static str> = BTreeMap::new();
        if self.options.local {
            let (_, invalid) = Self::decoded_visualizations(&graph);
            held_back.extend(invalid.into_iter().map(|script| (script, "its visualization doesn't decode")));
            let dataflow =
                self.workbook.try_borrow().map_err(|_| RunFailure::error("The workbook is busy"))?.dataflow();
            for (script, flow) in dataflow.scripts.iter().enumerate() {
                if flow.manual {
                    held_back.insert(script as u32, "runs only on request");
                }
            }
            for node in nodes(&graph).iter().filter(|node| node.client_function_call.is_some()) {
                held_back.insert(node.script, "calls a client function");
            }
        }
        let held: BTreeSet<u32> = held_back.keys().copied().collect();
        if let (PlanRun::Script(target), Some(targets)) = (&self.options.run, targets.as_deref()) {
            if targets.iter().all(|t| !nodes(&graph).iter().any(|node| node.script == *t)) {
                return Err(RunFailure::plan(format!("{target} holds no statement")));
            }
        }
        let visualizations = self.visualizations(&graph)?;
        self.validate(&graph, true)?;
        self.check_cancelled()?;
        // The keys of the scripts, the stored results that they reuse and the names of the files that they write
        let (keys, settled) = self.settle_results(&graph, &visualizations, &held).await?;
        let Settled { cached: cached_files, names, .. } = settled;

        // Scripts without statements are done right away, so are the scripts that reused their results
        let counted: Vec<u32> = targets.clone().unwrap_or_else(|| (0..count as u32).collect());
        // A plan of targets leaves out the targets that reused their results
        if let Some(t) = targets.as_mut() {
            t.retain(|target| !cached_files.contains_key(target));
            if t.is_empty() {
                let done = counted.len();
                self.emit(|state| state.completed_scripts += done);
                return Ok(vec![None; count]);
            }
        }
        // The plan of the scripts that run, it scans the reused results. A result that the run materializes is the new
        // file of its script, a transient file without a key.
        let mounts = host.mount_prefix().is_some();
        let materializations = graph.materializations.as_deref().unwrap_or_default();
        if !cached_files.is_empty() || (mounts && !materializations.is_empty()) {
            let mut files: Vec<(u32, String)> =
                cached_files.iter().map(|(script, file)| (*script, file.clone())).collect();
            if mounts {
                for materialization in materializations {
                    if files.iter().any(|(script, _)| *script == materialization.script) {
                        continue;
                    }
                    // The file of a script with a key has its name already, the keys downstream cover it
                    let name = match names.get(&materialization.script) {
                        Some(name) => name.clone(),
                        None => {
                            let name = host.mount_file_name(None);
                            self.transient.borrow_mut().push(name.clone());
                            name
                        }
                    };
                    files.push((materialization.script, name));
                }
            }
            let provided: Vec<u32> = cached_files.keys().copied().collect();
            let replanned = self.plan(targets.as_deref(), &provided, &files, &mount_prefix)?;
            // The keys, the reused results and the names of the files come from the first plan. A script that changed
            // during the lookups of the results would run its new text under the key of its old one.
            if !same_keyed_scripts(&graph, &replanned) {
                return Err(RunFailure::error("Workbook changed during execution"));
            }
            graph = replanned;
        }
        // A materialized result is the file of its script already
        let materialized: BTreeSet<u32> = graph.materializations.iter().flatten().map(|m| m.script).collect();
        let empty: Vec<u32> =
            counted.iter().copied().filter(|index| !nodes(&graph).iter().any(|node| node.script == *index)).collect();
        if !empty.is_empty() {
            let done = empty.len();
            self.emit(|state| state.completed_scripts += done);
        }
        for index in &empty {
            if !cached_files.contains_key(index) {
                self.host.script_event(&self.file(*index), &ScriptEvent::Done { key: None, query_id: None });
            }
        }
        let connection_ids: Vec<String> = graph
            .connections
            .iter()
            .flatten()
            .map(|connection| connection.connection_id.clone().unwrap_or_default())
            .collect();
        let mut skip = skipped_nodes(&graph, &connection_ids, &held, |connection| host.can_run(connection));
        // The scripts that run, with the scripts that they follow
        let mut follows: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();
        for (index, node) in nodes(&graph).iter().enumerate() {
            if !skip.contains(&(index as u32)) {
                follows.entry(node.script).or_default();
            }
        }
        for (script, earlier) in script_follows(&graph, count).into_iter().enumerate() {
            if let Some(set) = follows.get_mut(&(script as u32)) {
                set.extend(earlier);
            }
        }
        for (index, earlier) in &follows {
            let follows = earlier.iter().map(|script| self.file(*script)).collect();
            self.host.script_event(&self.file(*index), &ScriptEvent::Planned { follows });
        }
        // The connections that statements run on are set up at once, the scripts of a connection that can't be set up
        // are skipped
        let mut failed_setups: BTreeSet<String> = BTreeSet::new();
        if host.prepares_connections() {
            let mut needed: Vec<String> = Vec::new();
            for (index, node) in nodes(&graph).iter().enumerate() {
                let Some(connection) = connection_ids.get(node.connection as usize) else { continue };
                if !skip.contains(&(index as u32)) && !needed.contains(connection) {
                    needed.push(connection.clone());
                }
            }
            type Setup = Pin<Box<dyn Future<Output = Result<(), crate::host::HostError>>>>;
            let setups: Vec<Setup> =
                needed.iter().map(|connection| Box::pin(host.prepare_connection(connection)) as Setup).collect();
            let results = join_all(setups).await;
            for (connection, result) in needed.iter().zip(results) {
                if let Err(error) = result {
                    self.log(
                        LogLevel::Warn,
                        "A connection of the run could not be set up",
                        vec![
                            detail("workbookId", self.workbook_id.clone()),
                            detail("connectionId", connection.clone()),
                            detail("error", error.message()),
                        ],
                    );
                    failed_setups.insert(connection.clone());
                }
            }
            self.check_cancelled()?;
            if !failed_setups.is_empty() {
                skip = skipped_nodes(&graph, &connection_ids, &held, |connection| {
                    host.can_run(connection) && !failed_setups.contains(connection)
                });
            }
        }
        if !skip.is_empty() {
            let mut skipped: Vec<u32> = Vec::new();
            for node in &skip {
                if let Some(node) = nodes(&graph).get(*node as usize) {
                    if !skipped.contains(&node.script) {
                        skipped.push(node.script);
                    }
                }
            }
            let skipped_files: Vec<String> = skipped.iter().map(|index| self.file(*index)).collect();
            let skipped_count = skipped.len();
            let emitted_files = skipped_files.clone();
            let local = self.options.local;
            // The scripts that a run of a shown workbook leaves out are done, they need no connection
            self.emit(|state| {
                if local {
                    state.completed_scripts += skipped_count;
                } else {
                    state.skipped_scripts = skipped_count;
                    state.skipped_files = emitted_files;
                }
            });
            // Why a script didn't use a stored result, with the key it looked for
            let reason = |index: u32| {
                let connection = self.connection_of(index);
                if let Some(reason) = held_back.get(&index) {
                    return reason.to_string();
                }
                if failed_setups.contains(connection) {
                    return "its connection could not be set up".to_string();
                }
                if host.can_run(connection) {
                    return "follows a skipped script".to_string();
                }
                match keys.get(index as usize).cloned().flatten() {
                    None => "no stored result".to_string(),
                    Some(key) if !key.reusable => format!("result not reusable, key {}", key.key),
                    Some(key) => format!("no stored result of key {}", key.key),
                }
            };
            let described: Vec<String> =
                skipped.iter().map(|index| format!("{} ({})", self.file(*index), reason(*index))).collect();
            let message = if local {
                "Showing the stored results of the scripts that don't run"
            } else {
                "Skipping the scripts that need a connection"
            };
            self.log(
                LogLevel::Info,
                message,
                vec![detail("workbookId", self.workbook_id.clone()), detail("scripts", described.join(", "))],
            );
            for index in &skipped {
                self.host.script_event(&self.file(*index), &ScriptEvent::Skipped { reason: reason(*index) });
            }
            // A script that a run of a shown workbook leaves out shows its stored result
            if local {
                self.read_stored(&graph, &skipped, true).await?;
            }
        }
        let context = self.plan_context(graph, connection_ids, keys, names, materialized, skip)?;
        self.run_graph(Rc::new(context)).await
    }

    /// Read the stored results of scripts that don't run and show no result yet, whatever their keys, in feed order: a
    /// run of a shown workbook shows what it doesn't run. A script reads the file of its result node, one whose
    /// visualization doesn't decode reads nothing. Like a reused result, a read is no output of the run. Reads that
    /// aren't `stoppable` go on after the run was cancelled.
    async fn read_stored(
        self: &Rc<Self>,
        graph: &ExecutionGraphT,
        scripts: &[u32],
        stoppable: bool,
    ) -> Result<(), RunFailure> {
        if !self.host.has_results() {
            return Ok(());
        }
        let (visualizations, invalid) = Self::decoded_visualizations(graph);
        // The result node of every script that reads its file, in feed order
        let mut reads: BTreeMap<u32, usize> = BTreeMap::new();
        for (index, node) in nodes(graph).iter().enumerate() {
            if node.script_result
                && scripts.contains(&node.script)
                && !invalid.contains(&node.script)
                && !self.shows_result(node.script)
            {
                reads.entry(node.script).or_insert(index);
            }
        }
        self.validate(graph, true)?;
        let statements = planned_statements(graph, &self.files, &self.options.run);
        for (script, node) in reads {
            // The file stays pinned until the run released its files
            let retained = self.host.result_retain(&self.file(script)).await.ok().flatten();
            if let Some(retained) = &retained {
                self.kept.borrow_mut().push(retained.id);
            }
            if stoppable {
                self.check_cancelled()?;
            }
            let Some(retained) = retained else { continue };
            self.serve_cached(graph, script, node, &retained.file, &statements, &visualizations).await?;
            if stoppable {
                self.cooperate().await?;
            } else {
                self.host.cooperate().await;
            }
        }
        Ok(())
    }

    /// Does a script show a result already, e.g. of a run before the workbook opened?
    fn shows_result(&self, script: u32) -> bool {
        let Some(key) = self.keys.get(script as usize) else { return false };
        self.workbook
            .try_borrow()
            .is_ok_and(|workbook| workbook.script(*key).is_some_and(|script| script.latest_result_query_id().is_some()))
    }

    /// Reuse the stored result of a script, the query of the result or none if the file is gone
    async fn serve_cached(
        self: &Rc<Self>,
        graph: &ExecutionGraphT,
        script: u32,
        result_node: usize,
        file: &StoredFile,
        statements: &[PlannedStatement],
        visualizations: &[Option<ScriptVisualization>],
    ) -> Result<Option<QueryId>, RunFailure> {
        let Some(node) = nodes(graph).get(result_node) else { return Ok(None) };
        let Some(mut statement) = statements.get(result_node).cloned() else { return Ok(None) };
        statement.cached = true;
        let Some(script_key) = self.keys.get(script as usize).copied() else { return Ok(None) };
        let connection_id = self.connection_of(script).to_string();
        let mut details = vec![detail("workbookId", self.workbook_id.clone()), detail("key", file.key.clone())];
        details.extend(statement.log_fields());
        let request = StatementRequest {
            connection_id: connection_id.clone(),
            script_key,
            text: node.sql.clone().unwrap_or_default(),
            client_function_call: None,
            analyze_results: self.options.analyze,
            publish_results: true,
            result: StatementResult::Read { script: self.file(script), file: file.clone() },
            planned: statement,
        };
        self.launched.set(true);
        let handle = self.host.execute(request).map_err(RunFailure::from_statement)?;
        let query_id = handle.query_id;
        details.insert(1, detail("query", query_id.to_string()));
        self.log(LogLevel::Info, "Reusing the stored result of a script", details);
        self.control.active.borrow_mut().insert(query_id, ActiveQuery { connection_id, cancelling: false });
        let served = handle.done.await;
        self.control.active.borrow_mut().remove(&query_id);
        let has_result = match served {
            Ok(has_result) => has_result,
            Err(failure) if !failure.cache_miss => {
                // The script shows the error of the query
                self.finished.borrow_mut().insert(script);
                self.apply(WorkbookAction::RegisterQuery { key: script_key, query_id: query_id as u32 })?;
                return Err(RunFailure::from_statement(failure));
            }
            Err(_) => {
                let runs = self.host.can_run(self.connection_of(script));
                let message = if runs {
                    "The stored result of a script is gone, running it"
                } else {
                    "The stored result of a script is gone, it needs its connection"
                };
                self.log(
                    LogLevel::Info,
                    message,
                    vec![
                        detail("workbookId", self.workbook_id.clone()),
                        detail("query", query_id.to_string()),
                        detail("script", self.file(script)),
                        detail("key", file.key.clone()),
                    ],
                );
                return Ok(None);
            }
        };
        let visualization = visualizations.get(result_node).cloned().flatten();
        self.apply(WorkbookAction::RegisterQuery { key: script_key, query_id: query_id as u32 })?;
        self.apply(WorkbookAction::SetExecutionVisualization { key: script_key, visualization })?;
        if has_result {
            self.apply(WorkbookAction::RegisterScriptResult { key: script_key, query_id: query_id as u32 })?;
        }
        Ok(Some(query_id))
    }

    /// What the statements of a plan read
    fn plan_context(
        &self,
        graph: ExecutionGraphT,
        connection_ids: Vec<String>,
        keys: Vec<Option<ResultKey>>,
        names: BTreeMap<u32, String>,
        materialized: BTreeSet<u32>,
        skip: BTreeSet<u32>,
    ) -> Result<PlanContext, RunFailure> {
        let count = self.files.len();
        let statements = planned_statements(&graph, &self.files, &self.options.run);
        let visualizations = self.visualizations(&graph)?;
        let mut nodes_of_script: Vec<Vec<usize>> = vec![Vec::new(); count];
        let mut output_nodes: Vec<Option<usize>> = vec![None; count];
        for (index, node) in nodes(&graph).iter().enumerate() {
            if let Some(list) = nodes_of_script.get_mut(node.script as usize) {
                list.push(index);
            }
            if node.produces_output {
                if let Some(output) = output_nodes.get_mut(node.script as usize) {
                    *output = Some(index);
                }
            }
        }
        let mut successors: Vec<Vec<usize>> = vec![Vec::new(); nodes(&graph).len()];
        for edge in edges(&graph) {
            if let Some(list) = successors.get_mut(edge.from as usize) {
                if !list.contains(&(edge.to as usize)) {
                    list.push(edge.to as usize);
                }
            }
        }
        Ok(PlanContext {
            graph,
            connection_ids,
            statements,
            nodes_of_script,
            output_nodes,
            successors,
            visualizations,
            keys,
            names,
            materialized,
            skip,
        })
    }

    /// Run the nodes of a plan across their connections.
    ///
    /// A node starts when its predecessors are done, at most `max_concurrent_queries` nodes run on a connection at
    /// once. The node of a materialized script writes its result as Parquet file and mounts it before the nodes that
    /// scan it start. The last output of every script registers as the result of the script. A failed or cancelled
    /// run cancels the running nodes and settles once they are done, it writes no more files.
    async fn run_graph(self: &Rc<Self>, context: Rc<PlanContext>) -> Result<Vec<Option<QueryId>>, RunFailure> {
        let graph = &context.graph;
        let all = nodes(graph);
        let skip = &context.skip;
        let total = all.len().saturating_sub(skip.len());
        self.emit(|state| {
            state.phase = RunPhase::Running;
            state.total_statements = total;
        });
        // Validate after the notifications, but before the first statement. Later edits belong to the next run.
        self.validate(graph, true)?;
        let materializations = graph.materializations.as_deref().unwrap_or_default();
        let mounts = self.host.mount_prefix().is_some();
        if !mounts && materializations.iter().any(|m| m.node == NONE || !skip.contains(&m.node)) {
            return Err(RunFailure::error(
                "Scripts of other connections need the compute database to scan their results",
            ));
        }
        // The statements that scan attachments read them from the mount of the workbook
        let attachments = all.iter().enumerate().any(|(index, node)| {
            !skip.contains(&(index as u32)) && node.attachments.as_ref().is_some_and(|a| !a.is_empty())
        });
        if attachments {
            if !self.host.mounts_attachments() {
                return Err(RunFailure::error("Scripts that read attachments need the compute database"));
            }
            self.host.mount_attachments().await.map_err(|error| RunFailure::from_host(&error))?;
        }
        self.log_plan(&context);
        // The results that the host provides, e.g. cached results, are read in place
        for materialization in materializations {
            if materialization.node == NONE {
                self.pin(materialization.path.as_deref().unwrap_or_default()).await?;
            }
        }

        let mut predecessors = vec![0usize; all.len()];
        for (from, list) in context.successors.iter().enumerate() {
            if skip.contains(&(from as u32)) {
                continue;
            }
            for to in list {
                if !skip.contains(&(*to as u32)) {
                    if let Some(count) = predecessors.get_mut(*to) {
                        *count += 1;
                    }
                }
            }
        }
        let ready: Vec<usize> = (0..all.len())
            .filter(|index| !skip.contains(&(*index as u32)) && predecessors.get(*index) == Some(&0))
            .collect();
        let count = self.files.len();
        *self.schedule.borrow_mut() = Some(Schedule {
            predecessors,
            ready,
            running: vec![0; context.connection_ids.len()],
            running_total: 0,
            released: vec![false; all.len()],
            failure: None,
            outputs: vec![None; count],
            settled: vec![0; count],
            settled_total: 0,
            started: BTreeSet::new(),
            ended: BTreeSet::new(),
        });
        let max_concurrent: Vec<usize> = context
            .connection_ids
            .iter()
            .map(|connection| self.host.max_concurrent_queries(connection).max(1))
            .collect();

        let scheduled = self.schedule_nodes(&context, &max_concurrent).await;
        let failure = match scheduled {
            Err(failure) => {
                // E.g. the workbook changed, the statements that run already are cancelled
                self.with_schedule(|schedule| {
                    if schedule.failure.is_none() {
                        schedule.failure = Some(failure);
                    }
                });
                self.with_schedule(|schedule| schedule.failure.clone()).flatten()
            }
            Ok(()) => self.with_schedule(|schedule| schedule.failure.clone()).flatten(),
        };
        if failure.is_some() || self.control.cancelled.get() {
            let running = self.with_schedule(|schedule| schedule.running_total).unwrap_or(0);
            if running > 0 {
                self.log(
                    LogLevel::Info,
                    "Cancelling the running statements of the plan",
                    vec![detail("workbookId", self.workbook_id.clone()), detail("running", running.to_string())],
                );
            }
            self.cancel_active();
        }
        // The running statements are done before the files of the run are released. A statement that was released
        // early, e.g. once its result arrived, may still fail.
        self.settle().await;
        let failure = self.with_schedule(|schedule| schedule.failure.clone()).flatten();
        if failure.is_some() || self.control.cancelled.get() {
            // The scripts that started and didn't finish were stopped by the run
            let started: Vec<u32> =
                self.with_schedule(|schedule| schedule.started.iter().copied().collect()).unwrap_or_default();
            for script in started {
                self.end_script(script, ScriptEvent::Cancelled);
            }
            return Err(failure.unwrap_or_else(RunFailure::cancelled));
        }
        if self.with_schedule(|schedule| !schedule.ready.is_empty()).unwrap_or(false) {
            return Err(RunFailure::error("Execution plan has a cycle"));
        }
        let outputs = self.with_schedule(|schedule| schedule.outputs.clone()).unwrap_or_default();
        // A script whose last output isn't its last statement shows the output again
        for (script, output) in outputs.iter().enumerate() {
            let Some(query_id) = output else { continue };
            let Some(output_node) = context.output_nodes.get(script).copied().flatten() else { continue };
            let last = context.nodes_of_script.get(script).and_then(|nodes| nodes.last()).copied();
            if last == Some(output_node) {
                continue;
            }
            let Some(key) = self.keys.get(script).copied() else { continue };
            self.apply(WorkbookAction::RegisterQuery { key, query_id: *query_id as u32 })?;
            let visualization = context.visualizations.get(output_node).cloned().flatten();
            self.apply(WorkbookAction::SetExecutionVisualization { key, visualization })?;
        }
        Ok(outputs)
    }

    fn with_schedule<R>(&self, f: impl FnOnce(&mut Schedule) -> R) -> Option<R> {
        let mut schedule = self.schedule.try_borrow_mut().ok()?;
        schedule.as_mut().map(f)
    }

    /// Launch the ready nodes until the plan is done or stops
    async fn schedule_nodes(
        self: &Rc<Self>,
        context: &Rc<PlanContext>,
        max_concurrent: &[usize],
    ) -> Result<(), RunFailure> {
        let all = nodes(&context.graph);
        loop {
            let proceed = self
                .with_schedule(|schedule| {
                    (!schedule.ready.is_empty() || schedule.running_total > 0) && schedule.failure.is_none()
                })
                .unwrap_or(false);
            if !proceed || self.control.cancelled.get() {
                return Ok(());
            }
            // The ready nodes of the connections that have room, in node order
            let mut i = 0;
            loop {
                let next = self.with_schedule(|schedule| {
                    if schedule.failure.is_some() {
                        return None;
                    }
                    while i < schedule.ready.len() {
                        let node = schedule.ready.get(i).copied()?;
                        let connection = all.get(node).map(|node| node.connection as usize).unwrap_or(usize::MAX);
                        let running = schedule.running.get(connection).copied().unwrap_or(0);
                        let max = max_concurrent.get(connection).copied().unwrap_or(1);
                        if running >= max {
                            i += 1;
                            continue;
                        }
                        schedule.ready.remove(i);
                        return Some(node);
                    }
                    None
                });
                let Some(node) = next.flatten() else { break };
                if self.control.cancelled.get() {
                    break;
                }
                self.launch(context, node)?;
            }
            if self.with_schedule(|schedule| schedule.running_total).unwrap_or(0) == 0 {
                return Ok(());
            }
            self.control.wait().await;
        }
    }

    /// The successors of a node may start, e.g. once its result arrived
    fn release(&self, context: &PlanContext, node: usize) {
        let connection = nodes(&context.graph).get(node).map(|node| node.connection as usize);
        let changed = self.with_schedule(|schedule| {
            match schedule.released.get_mut(node) {
                Some(released) if !*released => *released = true,
                _ => return false,
            }
            if let Some(running) = connection.and_then(|connection| schedule.running.get_mut(connection)) {
                *running = running.saturating_sub(1);
            }
            schedule.running_total = schedule.running_total.saturating_sub(1);
            for successor in context.successors.get(node).into_iter().flatten() {
                if let Some(count) = schedule.predecessors.get_mut(*successor) {
                    *count = count.saturating_sub(1);
                    if *count == 0 && !context.skip.contains(&(*successor as u32)) {
                        schedule.ready.push(*successor);
                    }
                }
            }
            schedule.ready.sort_unstable();
            true
        });
        if changed == Some(true) {
            self.control.wake();
        }
    }

    /// Report the end of a script once
    fn end_script(&self, script: u32, event: ScriptEvent) {
        let first = self.with_schedule(|schedule| schedule.ended.insert(script)).unwrap_or(false);
        if first && matches!(event, ScriptEvent::Done { .. } | ScriptEvent::Failed { .. }) {
            self.finished.borrow_mut().insert(script);
        }
        if first {
            self.host.script_event(&self.file(script), &event);
        }
    }

    /// Start the statement of a node
    fn launch(self: &Rc<Self>, context: &Rc<PlanContext>, index: usize) -> Result<(), RunFailure> {
        self.validate(&context.graph, false)?;
        let Some(node) = nodes(&context.graph).get(index) else {
            return Err(RunFailure::error(format!("The plan has no statement {index}")));
        };
        let script = node.script;
        let statements = context.nodes_of_script.get(script as usize).map(Vec::as_slice).unwrap_or_default();
        let position = statements.iter().position(|n| *n == index).unwrap_or(0);
        let output = context.output_nodes.get(script as usize).copied().flatten() == Some(index);
        let visualization = context.visualizations.get(index).cloned().flatten();
        let connection_id = context.connection_ids.get(node.connection as usize).cloned().unwrap_or_default();
        let materialization =
            (node.materialization != NONE).then(|| graph_path(&context.graph, node.materialization)).flatten();
        let file = self.file(script);
        let statement_count = statements.len() as u32;
        self.emit(|state| {
            state.active_file_name = Some(file.clone());
            state.active_statement_index = Some(position as u32 + 1);
            state.active_statement_count = Some(statement_count);
        });
        let first = self.with_schedule(|schedule| {
            if let Some(running) = schedule.running.get_mut(node.connection as usize) {
                *running += 1;
            }
            schedule.running_total += 1;
            schedule.started.insert(script)
        });
        if first == Some(true) {
            self.host.script_event(&file, &ScriptEvent::Started);
        }
        // A statement that can't start releases its node, the run fails instead of waiting for it
        let Some(planned) = context.statements.get(index).cloned() else {
            self.release(context, index);
            return Err(RunFailure::error(format!("The plan has no statement {index}")));
        };
        let Some(script_key) = self.keys.get(script as usize).copied() else {
            self.release(context, index);
            return Err(RunFailure::error(format!("The run has no script {}", self.file(script))));
        };
        // The result of a script becomes its stored result, a materialized result is the file of the script already
        let key = context.keys.get(script as usize).cloned().flatten();
        let result = match key {
            Some(key) if node.script_result && !context.materialized.contains(&script) => {
                let file = self.file(script);
                let name = context.names.get(&script).cloned();
                let name = name.unwrap_or_else(|| self.host.mount_file_name(Some((file.as_str(), key.key.as_str()))));
                StatementResult::Store { script: file, key: key.key, name }
            }
            _ => StatementResult::None,
        };
        let stores = matches!(result, StatementResult::Store { .. });
        let request = StatementRequest {
            connection_id: connection_id.clone(),
            script_key,
            text: node.sql.clone().unwrap_or_default(),
            client_function_call: node.client_function_call.clone(),
            analyze_results: output && self.options.analyze,
            publish_results: output || materialization.is_some(),
            result,
            planned: planned.clone(),
        };
        self.launched.set(true);
        let handle = match self.host.execute(request) {
            Ok(handle) => handle,
            Err(failure) => {
                self.release(context, index);
                return Err(RunFailure::from_statement(failure));
            }
        };
        let query_id = handle.query_id;
        let mut details = vec![
            detail("workbookId", self.workbook_id.clone()),
            detail("query", query_id.to_string()),
            detail("connectionId", connection_id.clone()),
        ];
        details.extend(planned.log_fields());
        details.push(detail("storesResult", stores.to_string()));
        self.log(LogLevel::Info, "Running a planned statement", details);
        self.control
            .active
            .borrow_mut()
            .insert(query_id, ActiveQuery { connection_id: connection_id.clone(), cancelling: false });
        self.apply(WorkbookAction::RegisterQuery { key: script_key, query_id: query_id as u32 })?;
        if output {
            self.apply(WorkbookAction::SetExecutionVisualization {
                key: script_key,
                visualization: visualization.clone(),
            })?;
        }

        let run = self.clone();
        let context = context.clone();
        let mut ready = handle.ready;
        let mut done = handle.done;
        self.spawn(async move {
            let result: Result<bool, RunFailure> = async {
                // The statements after it start once its result arrived, a materialized result must be written first
                let end = if materialization.is_none() {
                    let first = std::future::poll_fn(|cx| {
                        if let Poll::Ready(end) = done.as_mut().poll(cx) {
                            return Poll::Ready(Some(end));
                        }
                        ready.as_mut().poll(cx).map(|_| None)
                    })
                    .await;
                    match first {
                        Some(end) => end,
                        None => {
                            run.release(&context, index);
                            done.await
                        }
                    }
                } else {
                    done.await
                };
                let has_result = end.map_err(RunFailure::from_statement)?;
                if let Some(path) = &materialization {
                    // A failed or cancelled run writes no more files
                    if let Some(failure) = run.with_schedule(|schedule| schedule.failure.clone()).flatten() {
                        return Err(failure);
                    }
                    run.check_cancelled()?;
                    if !has_result {
                        return Err(RunFailure::error(format!(
                            "{} has no result that other scripts could read",
                            run.file(script)
                        )));
                    }
                    run.pin(path).await?;
                    let rows =
                        run.host.mount_write(path, query_id).await.map_err(|error| RunFailure::from_host(&error))?;
                    run.log(
                        LogLevel::Info,
                        "Wrote a materialized script result",
                        vec![
                            detail("workbookId", run.workbook_id.clone()),
                            detail("query", query_id.to_string()),
                            detail("script", run.file(script)),
                            detail("path", path.clone()),
                            detail("rows", rows.to_string()),
                        ],
                    );
                }
                Ok(has_result)
            }
            .await;
            run.settle_statement(&context, index, script, script_key, query_id, output, visualization, result).await;
        });
        Ok(())
    }

    /// A statement ended
    #[allow(clippy::too_many_arguments)]
    async fn settle_statement(
        self: &Rc<Self>,
        context: &PlanContext,
        index: usize,
        script: u32,
        script_key: ScriptKey,
        query_id: QueryId,
        output: bool,
        visualization: Option<ScriptVisualization>,
        result: Result<bool, RunFailure>,
    ) {
        self.release(context, index);
        let registered = match result {
            Ok(has_result) => {
                let mut registered = Ok(());
                if output {
                    registered =
                        self.apply(WorkbookAction::SetExecutionVisualization { key: script_key, visualization });
                    if registered.is_ok() && has_result {
                        registered = self
                            .apply(WorkbookAction::RegisterScriptResult { key: script_key, query_id: query_id as u32 });
                    }
                    self.with_schedule(|schedule| {
                        if let Some(slot) = schedule.outputs.get_mut(script as usize) {
                            *slot = Some(query_id);
                        }
                    });
                }
                registered
            }
            Err(failure) => Err(failure),
        };
        self.control.active.borrow_mut().remove(&query_id);
        match registered {
            Ok(()) => {
                if self.control.cancelled.get() {
                    self.control.wake();
                    return;
                }
                self.emit(|state| state.completed_statements += 1);
                let (done, yields) = self
                    .with_schedule(|schedule| {
                        schedule.settled_total += 1;
                        let settled = schedule.settled.get_mut(script as usize).map(|count| {
                            *count += 1;
                            *count
                        });
                        let all = context.nodes_of_script.get(script as usize).map(Vec::len);
                        (settled.is_some() && settled == all, schedule.settled_total % EXECUTION_YIELD_INTERVAL == 0)
                    })
                    .unwrap_or((false, false));
                if done {
                    self.emit(|state| state.completed_scripts += 1);
                    let query_id = self
                        .with_schedule(|schedule| schedule.outputs.get(script as usize).copied().flatten())
                        .flatten();
                    self.end_script(script, ScriptEvent::Done { key: context.done_key(script), query_id });
                }
                if yields {
                    self.host.cooperate().await;
                }
            }
            Err(failure) => {
                // The failures of cancelled statements are no failures of the run
                let first = self.with_schedule(|schedule| schedule.failure.is_none()).unwrap_or(false)
                    && !self.control.cancelled.get();
                let mut details =
                    vec![detail("workbookId", self.workbook_id.clone()), detail("query", query_id.to_string())];
                if let Some(connection) = nodes(&context.graph)
                    .get(index)
                    .and_then(|node| context.connection_ids.get(node.connection as usize))
                {
                    details.push(detail("connectionId", connection.clone()));
                }
                if let Some(statement) = context.statements.get(index) {
                    details.extend(statement.log_fields());
                }
                details.push(detail("error", failure.message.clone()));
                if first {
                    self.log(LogLevel::Warn, "A planned statement failed", details);
                    self.with_schedule(|schedule| schedule.failure = Some(failure.clone()));
                    self.end_script(script, ScriptEvent::Failed { failure });
                    self.cancel_active();
                } else {
                    self.log(LogLevel::Info, "A planned statement stopped", details);
                }
            }
        }
        self.control.wake();
    }

    /// Log a plan before it runs: its statements and the materialized results
    fn log_plan(&self, context: &PlanContext) {
        let graph = &context.graph;
        let planned = graph.scripts.iter().flatten().filter(|script| script.planned).count();
        let materializations: Vec<String> = graph
            .materializations
            .iter()
            .flatten()
            .map(|m| {
                let source = if m.node == NONE { "cached".to_string() } else { format!("node {}", m.node) };
                format!("{}: {} -> {}", self.file(m.script), source, m.path.clone().unwrap_or_default())
            })
            .collect();
        let inlined: Vec<String> = context
            .statements
            .iter()
            .filter(|s| !s.inlined.is_empty())
            .map(|s| format!("{} {} inlines {}", s.node, s.script, s.inlined.join(" ")))
            .collect();
        let run = match &self.options.run {
            PlanRun::Workbook => "workbook".to_string(),
            PlanRun::Script(target) => format!("script {target}"),
        };
        self.log(
            LogLevel::Info,
            "Running a plan of workbook scripts",
            vec![
                detail("workbookId", self.workbook_id.clone()),
                detail("run", run),
                detail("scripts", planned.to_string()),
                detail("nodes", nodes(graph).len().to_string()),
                detail("edges", edges(graph).len().to_string()),
                detail("materializations", materializations.join(", ")),
                detail("inlined", inlined.join(", ")),
            ],
        );
    }
}

/// Do the scripts of a plan keep what their result keys derive from in a later plan? Every script that the first plan
/// planned keeps its text, and one that both plan keeps its signature, whether it can be cached and the scripts it
/// references.
fn same_keyed_scripts(first: &ExecutionGraphT, next: &ExecutionGraphT) -> bool {
    let (first, next) = (first.scripts.as_deref().unwrap_or_default(), next.scripts.as_deref().unwrap_or_default());
    first.len() == next.len()
        && first.iter().zip(next).filter(|(before, _)| before.planned).all(|(before, after)| {
            before.text_version == after.text_version
                && (!after.planned
                    || (before.signature == after.signature
                        && before.cacheable == after.cacheable
                        && before.referenced_scripts == after.referenced_scripts))
        })
}

/// The path of a materialization
fn graph_path(graph: &ExecutionGraphT, index: u32) -> Option<String> {
    graph.materializations.as_ref()?.get(index as usize).map(|m| m.path.clone().unwrap_or_default())
}
