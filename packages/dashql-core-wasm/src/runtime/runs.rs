//! The runs of workbooks of the runtime (docs/design/dashql_core.md): the service that starts and stops them, and the
//! host of the run of the crate (`dashql_core_runtime::workbook_run`) on the runtime.
//!
//! A workbook has one run at a time: a run of the whole workbook, of the scripts that a change of inputs affects, or of
//! one script with the scripts it references. The run holds the workbook until it ended, the `run` slice of the
//! workbook shows the hold and the state of its last run of the whole workbook. A run of the workbook takes every
//! connection of its scripts and starts only while they are idle: no run holds one, none is connecting and none runs a
//! query but the SQLFrame queries of computations. It runs statements on the connections that were online when it
//! started and stops when one of them drops. A change of inputs while the workbook is busy stops the run that holds it
//! and waits: it starts once the workbook is free, with the inputs of every change since, or is dropped after a while.
//! A run that prepares its connections (the command line tool) sets them up before its first statement through its
//! listener and needs no compute database.
//!
//! The statements of a run are queries of the histories of their connections on the executor of the runtime
//! (`Connections::run_statement`). The files of a run, the cached results it scans, the results it materializes and
//! the attachments, are files of the platform (`mounts`, `resultCache`). The runtime reads the columns of the Parquet
//! attachments of the workbooks once per file with the compute database.

mod cached_results;
pub(crate) mod view;

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::future::Future;
use std::rc::{Rc, Weak};

use dashql_core_runtime::connections::label::is_hyper_wasm_connection;
use dashql_core_runtime::connections::registry::QueryOwner;
use dashql_core_runtime::connections::{ConnectionHealth, ConnectionState, ConnectorType};
use dashql_core_runtime::executor::{FailureKind, QueryId};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::query::{QueryError, QueryExecutionAction, QueryExecutionState, QueryMetadata, QueryType};
use dashql_core_runtime::workbook::{next_revision, RunPlanRequest, Workbook, WorkbookAction, WorkbookEffect};
use dashql_core_runtime::workbook_run::plan::result_keys;
use dashql_core_runtime::workbook_run::{
    start_run, PlanRun, RetainedFile, RunFailureKind, RunHandle, RunHost, RunOptions, RunState, ScriptEvent, StatementCache, StatementFailure,
    StatementHandle, StatementRequest, LOG_TARGET,
};
use js_sys::{Array, Function, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;

use super::changes::{Read, Slice};
use super::connections::Connections;
use super::queries::{LocalFuture, Statement};
use super::workbooks::Workbooks;
use crate::host::{host_error, JsPlatform};
use view::{RunOutcome, RunScriptOptions, RunWorkbookOptions, StatementError, WorkbookRunKind, WorkbookRunState, WorkbookRunView, WorkbookScriptRunEvent};

#[wasm_bindgen(typescript_custom_section)]
const RUN_LISTENER: &str = r#"
/** What hears a run of a workbook */
export interface RunListener {
    /** Something happened to a script of the run, a failure comes with what the platform failed with */
    script?(file: string, event: WorkbookScriptRunEvent, error: unknown): void;
    /** Set up a connection that statements run on before the first statement, e.g. with the credentials of the command line tool. The scripts of a connection whose setup rejects are skipped. A run with it takes every connection of the workbook. */
    prepareConnection?(connectionId: string): Promise<void>;
}
"#;

/// How long a change of inputs waits for its workbook
const PENDING_INPUTS_MS: f64 = 5_000.0;

/// The run that holds a workbook
struct HeldRun {
    kind: WorkbookRunKind,
    /// The number of the run, a run changes the entry only while it holds it
    number: u64,
    /// Stops the run
    handle: Rc<RunHandle<RuntimeRunHost>>,
    /// The connections that the run of the workbook takes, no other run of a workbook starts on them
    connections: Vec<String>,
    /// The connections that were online when the run of the workbook started, it stops when one of them drops
    online: Vec<String>,
}

/// A change of inputs that waits for the workbook
struct PendingInputs {
    inputs: Vec<String>,
    /// Tells apart the waits of the changes, a wait drops only its own change
    generation: u64,
}

/// The runs of a workbook
struct RunEntry {
    workbook_id: String,
    held: Option<HeldRun>,
    /// The state of the last run of the whole workbook
    state: Option<WorkbookRunState>,
    pending: Option<PendingInputs>,
    /// The revision of the slice, changes with every change of the entry
    revision: u64,
}

/// The runs of the workbooks of a runtime
pub(crate) struct Runs {
    platform: JsPlatform,
    connections: Rc<Connections>,
    workbooks: Rc<Workbooks>,
    entries: RefCell<Vec<RunEntry>>,
    /// The number of the last run, the platform names the files of a run by it
    numbers: Cell<u64>,
    /// The Parquet attachments whose columns were read, by workbook, file and stamp
    described: RefCell<BTreeSet<String>>,
    /// The cached results of the scripts that the runtime looked up
    cached: cached_results::CachedResults,
    destroyed: Cell<bool>,
}

/// What a workbook runs on
struct WorkbookScope {
    workbook: Rc<RefCell<Workbook>>,
    /// The connections of the scripts in feed order
    connections: Vec<String>,
    preview: bool,
    empty: bool,
}

/// The number of statements of a run that a connection runs at once: a Hyper server runs four, the others one
fn max_concurrent_queries(state: &ConnectionState) -> usize {
    let protocol = state.details().setup_params.as_ref().and_then(|params| params.get("protocol")).and_then(|protocol| protocol.as_str());
    match (state.connector_type(), protocol) {
        (ConnectorType::Hyper, Some(protocol)) if protocol != "WASM" => 4,
        _ => 1,
    }
}

/// Does a connection run a query? The SQLFrame queries of computations run on the compute database, the connection
/// only tracks them.
fn runs_queries(queries: &dashql_core_runtime::query::QueryExecutionHistory) -> bool {
    queries.active_ids().iter().filter_map(|id| queries.query(*id)).any(|query| query.query_metadata.query_type != QueryType::InternalSqlframe)
}

/// The owner of the result of a script
fn result_owner(workbook_id: &str, script_key: u32) -> String {
    format!("{workbook_id}/{script_key}")
}

impl Runs {
    pub fn new(platform: JsPlatform, connections: Rc<Connections>, workbooks: Rc<Workbooks>) -> Rc<Self> {
        let runs = Rc::new(Runs {
            platform,
            connections: connections.clone(),
            workbooks,
            entries: RefCell::new(Vec::new()),
            numbers: Cell::new(0),
            described: RefCell::new(BTreeSet::new()),
            cached: Default::default(),
            destroyed: Cell::new(false),
        });
        // The runs follow the changes of the registry: dropped connections, workbooks that are gone, changes of inputs
        // that wait for connections
        let weak = Rc::downgrade(&runs);
        *connections.follow_listener.borrow_mut() = Some(Rc::new(move || {
            if let Some(runs) = weak.upgrade() {
                runs.follow();
            }
        }));
        // The cached results of the scripts follow the changes of the workbooks, e.g. their analyses
        let weak = Rc::downgrade(&runs);
        *runs.workbooks.changed_listener.borrow_mut() = Some(Rc::new(move |workbook_id: &str| {
            if let Some(runs) = weak.upgrade() {
                runs.check_cached_results(Some(workbook_id));
            }
        }));
        // And the changes of the connections of the workbooks: their params, the files of the cache keys of their queries
        let weak = Rc::downgrade(&runs);
        *connections.results_listener.borrow_mut() = Some(Rc::new(move |workbook_ids: &[String], files: bool| {
            if let Some(runs) = weak.upgrade() {
                runs.check_workbooks_cached_results(workbook_ids, files);
            }
        }));
        // A file that the cache evicted is a cached result of no script
        let weak = Rc::downgrade(&runs);
        runs.platform.on_cache_evicted(Rc::new(move || {
            if let Some(runs) = weak.upgrade() {
                runs.forget_cached_results();
            }
        }));
        // A workbook that is deleted or replaced takes its run with it
        let weak = Rc::downgrade(&runs);
        *runs.workbooks.removed_listener.borrow_mut() = Some(Rc::new(move |workbook_id: &str| {
            if let Some(runs) = weak.upgrade() {
                runs.forget(workbook_id);
            }
        }));
        runs
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }

    /// Change the entry of a workbook, it is created when needed. Tells the platform that the slice changed.
    fn update<R>(&self, workbook_id: &str, change: impl FnOnce(&mut RunEntry) -> R) -> R {
        let result = {
            let mut entries = self.entries.borrow_mut();
            if let Some(entry) = entries.iter_mut().find(|entry| entry.workbook_id == workbook_id) {
                entry.revision = next_revision();
                change(entry)
            } else {
                let mut entry = RunEntry { workbook_id: workbook_id.to_string(), held: None, state: None, pending: None, revision: next_revision() };
                let result = change(&mut entry);
                entries.push(entry);
                result
            }
        };
        self.platform.changed(Slice::Runs, true);
        result
    }

    /// Change the entry of a workbook while a run of a number holds it, none otherwise: the run of a workbook that was
    /// deleted or replaced changes nothing
    fn update_held<R>(&self, workbook_id: &str, number: u64, change: impl FnOnce(&mut RunEntry) -> R) -> Option<R> {
        let holds = self.read(workbook_id, |entry| entry.and_then(|entry| entry.held.as_ref()).is_some_and(|held| held.number == number));
        holds.then(|| self.update(workbook_id, change))
    }

    /// Forget the run of a workbook that was deleted or replaced: a run that holds it stops, the slice goes
    pub fn forget(&self, workbook_id: &str) {
        // The attachments of the workbook leave the compute database, a replaced workbook mounts them again
        if self.platform.has_mounts() {
            let unmount = self.platform.mounts_call("dropAttachments", &[JsValue::from_str(workbook_id)]);
            let platform = self.platform.clone();
            self.platform.spawn(Box::pin(async move {
                if let Err(error) = unmount.await {
                    platform.log_on(LogLevel::Warn, "Unmounting the attachments of a workbook failed", &[("error", error.message())], LOG_TARGET);
                }
            }));
        }
        let removed = {
            let mut entries = self.entries.borrow_mut();
            let position = entries.iter().position(|entry| entry.workbook_id == workbook_id);
            position.map(|position| entries.remove(position))
        };
        let Some(removed) = removed else { return };
        if let Some(held) = removed.held {
            held.handle.cancel();
        }
        self.platform.changed(Slice::Runs, true);
    }

    /// Read the entry of a workbook
    fn read<R>(&self, workbook_id: &str, read: impl FnOnce(Option<&RunEntry>) -> R) -> R {
        let entries = self.entries.borrow();
        read(entries.iter().find(|entry| entry.workbook_id == workbook_id))
    }

    /// The scope of a run of a workbook of the runtime
    fn scope(&self, workbook_id: &str) -> Option<WorkbookScope> {
        let workbook = self.workbooks.get(workbook_id)?;
        let (connections, preview, empty) = {
            let held = workbook.try_borrow().ok()?;
            let mut connections: Vec<String> = Vec::new();
            for script in held.scripts() {
                let id = &script.connection().connection_id;
                if !connections.contains(id) {
                    connections.push(id.clone());
                }
            }
            (connections, held.is_cloud_preview(), held.scripts().is_empty())
        };
        Some(WorkbookScope { workbook, connections, preview, empty })
    }

    /// Why a run of a workbook can't start now, none if it can
    fn blocker(&self, workbook_id: &str, connections: &[String], prepares: bool) -> Option<String> {
        // The compute database reads the cached results, a run before its setup would fail or skip them
        if !prepares && !self.platform.has_compute() {
            return Some("the compute database is not set up".into());
        }
        let entries = self.entries.borrow();
        if entries.iter().any(|entry| entry.workbook_id == workbook_id && entry.held.is_some()) {
            return Some("a run holds the workbook".into());
        }
        let registry = self.connections.registry.borrow();
        for connection_id in connections {
            let Some(connection) = registry.get(connection_id) else {
                return Some(format!("the connection {connection_id} is unknown"));
            };
            if entries.iter().any(|entry| entry.held.as_ref().is_some_and(|held| held.connections.contains(connection_id))) {
                return Some(format!("a run holds the connection {connection_id}"));
            }
            if connection.state.try_borrow().is_ok_and(|state| state.health() == ConnectionHealth::Connecting) {
                return Some(format!("the connection {connection_id} is connecting"));
            }
            if connection.queries.try_borrow().is_ok_and(|queries| runs_queries(&queries)) {
                return Some(format!("the connection {connection_id} runs a query"));
            }
        }
        None
    }

    /// The connections of a workbook that are online, those of the embedded Hyper only for a preview of a published
    /// workbook
    fn online(&self, connections: &[String], preview: bool) -> Vec<String> {
        let registry = self.connections.registry.borrow();
        connections
            .iter()
            .filter(|id| {
                registry.get(id).is_some_and(|connection| {
                    connection
                        .state
                        .try_borrow()
                        .is_ok_and(|state| state.health() == ConnectionHealth::Online && (!preview || is_hyper_wasm_connection(&state)))
                })
            })
            .cloned()
            .collect()
    }

    /// The host of a new run
    fn host(self: &Rc<Self>, scope: &WorkbookScope, workbook_id: &str, can_run: Option<Vec<String>>, listener: Option<JsValue>) -> RuntimeRunHost {
        let number = self.numbers.get() + 1;
        self.numbers.set(number);
        let prepares = listener.as_ref().and_then(|listener| member_function(listener, "prepareConnection")).is_some();
        RuntimeRunHost {
            runs: Rc::downgrade(self),
            platform: self.platform.clone(),
            connections: self.connections.clone(),
            workbooks: Rc::downgrade(&self.workbooks),
            workbook: Rc::downgrade(&scope.workbook),
            workbook_id: workbook_id.to_string(),
            number,
            can_run,
            listener,
            prepares,
            keyed_files: RefCell::new(BTreeSet::new()),
        }
    }

    /// Run the scripts of a workbook, or queue a change of inputs until the workbook is free. Resolves with how the run
    /// ended and what the platform failed with.
    pub fn run_workbook(self: &Rc<Self>, workbook_id: &str, options: RunWorkbookOptions, listener: Option<JsValue>) -> LocalFuture<(RunOutcome, JsValue)> {
        let refused = |reason: &str| -> LocalFuture<(RunOutcome, JsValue)> { Box::pin(std::future::ready((RunOutcome::refused(reason), JsValue::UNDEFINED))) };
        if self.destroyed.get() {
            return refused("the runtime was destroyed");
        }
        let Some(scope) = self.scope(workbook_id) else {
            return refused(&format!("no workbook registered with id {workbook_id}"));
        };
        let prepares = listener.as_ref().and_then(|listener| member_function(listener, "prepareConnection")).is_some();
        // The app runs nothing in a workbook without scripts, the command line tool reports an empty run
        if scope.empty && !prepares {
            return refused("the workbook has no scripts");
        }
        let mut inputs = options.inputs.clone();
        if let Some(changed) = &options.inputs {
            let pending = self.read(workbook_id, |entry| entry.is_some_and(|entry| entry.pending.is_some()));
            let blocker = self.blocker(workbook_id, &scope.connections, prepares);
            if pending || blocker.is_some() {
                // The latest values win: the run that holds the workbook stops, the run starts once the workbook is free
                let (merged, generation, handle) = self.update(workbook_id, |entry| {
                    let generation = next_revision();
                    let pending = entry.pending.get_or_insert_with(|| PendingInputs { inputs: Vec::new(), generation });
                    for input in changed {
                        if !pending.inputs.contains(input) {
                            pending.inputs.push(input.clone());
                        }
                    }
                    (pending.inputs.clone(), pending.generation, entry.held.as_ref().map(|held| held.handle.clone()))
                });
                if let Some(handle) = handle {
                    handle.cancel();
                }
                if !pending {
                    let reason = blocker.unwrap_or_default();
                    let inputs = merged.join(", ");
                    self.log(LogLevel::Info, "A change of inputs waits for the workbook", &[("workbookId", workbook_id), ("inputs", &inputs), ("reason", &reason)]);
                    self.drop_pending_later(workbook_id, generation);
                }
                return refused("the change of inputs waits for the workbook");
            }
            inputs = Some(changed.clone());
        }
        if let Some(reason) = self.blocker(workbook_id, &scope.connections, prepares) {
            self.log(LogLevel::Info, "Not starting the run of a workbook", &[("workbookId", workbook_id), ("reason", &reason)]);
            return refused(&reason);
        }
        // A connection that comes online during the run doesn't join it. A run that prepares its connections runs on all.
        let online = if prepares { Vec::new() } else { self.online(&scope.connections, scope.preview) };
        let can_run = (!prepares).then(|| online.clone());
        let offline: Vec<String> = scope.connections.iter().filter(|id| !online.contains(id)).cloned().collect();
        let cache = (self.platform.has_cache() && self.platform.has_mounts()).to_string();
        let inputs_text = inputs.as_ref().map(|inputs| inputs.join(", ")).unwrap_or_default();
        self.log(
            LogLevel::Info,
            "Starting the run of a workbook",
            &[("workbookId", workbook_id), ("inputs", &inputs_text), ("online", &online.join(", ")), ("offline", &offline.join(", ")), ("cache", &cache)],
        );
        let host = self.host(&scope, workbook_id, can_run, listener);
        let number = host.number;
        let run_options = RunOptions {
            run: PlanRun::Workbook,
            targets: options.targets,
            inputs,
            refresh: options.refresh.unwrap_or(false),
            reports_state: true,
            analyze: options.analyze.unwrap_or(true),
        };
        let (handle, run) = start_run(Rc::new(host), scope.workbook.clone(), run_options);
        let connections = scope.connections.clone();
        self.update(workbook_id, |entry| {
            entry.held = Some(HeldRun { kind: WorkbookRunKind::Workbook, number, handle: Rc::new(handle), connections, online });
        });
        let runs = self.clone();
        let workbook_id = workbook_id.to_string();
        Box::pin(async move {
            let result = run.await;
            if let Some(failure) = result.failure.as_ref().filter(|failure| failure.kind != RunFailureKind::Cancelled) {
                runs.log(LogLevel::Info, "The run of a workbook failed", &[("workbookId", &workbook_id), ("error", &failure.message)]);
            }
            runs.release(&workbook_id, number);
            RunOutcome::of(&result)
        })
    }

    /// Run a script with the scripts it references. An outdated analysis of the script is analyzed first. A plan that
    /// fails and a run that fails before its statements show their error as a failed query of the script. Resolves
    /// with how the run ended and what the platform failed with.
    pub fn run_script(self: &Rc<Self>, workbook_id: &str, script_key: u32, options: RunScriptOptions) -> LocalFuture<(RunOutcome, JsValue)> {
        let refused = |reason: &str| -> LocalFuture<(RunOutcome, JsValue)> { Box::pin(std::future::ready((RunOutcome::refused(reason), JsValue::UNDEFINED))) };
        if self.destroyed.get() {
            return refused("the runtime was destroyed");
        }
        let Some(scope) = self.scope(workbook_id) else {
            return refused(&format!("no workbook registered with id {workbook_id}"));
        };
        if self.read(workbook_id, |entry| entry.is_some_and(|entry| entry.held.is_some())) {
            return refused("a run holds the workbook");
        }
        // A preview of a published workbook runs nothing until it is imported
        if scope.preview {
            self.log(LogLevel::Warn, "A preview of a published workbook does not run", &[("workbookId", workbook_id)]);
            return refused("the workbook is a preview of a published workbook");
        }
        let script = scope.workbook.try_borrow().ok().and_then(|workbook| {
            let index = workbook.scripts().iter().position(|script| script.key() == script_key)?;
            let script = workbook.scripts().get(index)?;
            Some((index as u32, script.file_name().to_string(), script.connection().connection_id.clone(), script.is_analysis_outdated()))
        });
        let Some((index, file, connection_id, outdated)) = script else {
            return refused(&format!("the workbook has no script {script_key}"));
        };
        let key = script_key.to_string();
        self.log(
            LogLevel::Info,
            "Workbook script execution requested",
            &[("connectionId", &connection_id), ("workbookId", workbook_id), ("scriptKey", &key), ("analysisOutdated", &outdated.to_string())],
        );
        if outdated {
            if let Err(error) = self.workbooks.apply(workbook_id, WorkbookAction::AnalyzeOutdatedScript { key: script_key }) {
                self.log(LogLevel::Warn, "The analysis of a script failed, it does not run", &[("workbookId", workbook_id), ("scriptKey", &key), ("error", error.what())]);
                return refused(error.what());
            }
        }
        let host = self.host(&scope, workbook_id, None, None);
        let number = host.number;
        let run_options = RunOptions {
            run: PlanRun::Script(file),
            targets: Some(vec![index]),
            inputs: None,
            refresh: options.refresh.unwrap_or(false),
            reports_state: false,
            analyze: true,
        };
        let (handle, run) = start_run(Rc::new(host), scope.workbook.clone(), run_options);
        self.update(workbook_id, |entry| {
            entry.held = Some(HeldRun { kind: WorkbookRunKind::Script, number, handle: Rc::new(handle), connections: Vec::new(), online: Vec::new() });
        });
        let runs = self.clone();
        let workbook_id = workbook_id.to_string();
        Box::pin(async move {
            let result = run.await;
            if let Some(failure) = &result.failure {
                // The script shows why it can't be planned or run where it shows the error of a failed statement
                if failure.kind == RunFailureKind::Plan || !result.launched {
                    runs.record_failure(&workbook_id, script_key, &connection_id, &failure.message);
                }
                runs.log(LogLevel::Warn, "Workbook script run failed", &[("workbookId", &workbook_id), ("scriptKey", &key), ("error", &failure.message)]);
            }
            runs.release(&workbook_id, number);
            RunOutcome::of(&result)
        })
    }

    /// Record an error of a run before its statements as a failed query of the script
    fn record_failure(&self, workbook_id: &str, script_key: u32, connection_id: &str, message: &str) {
        let text = self
            .workbooks
            .get(workbook_id)
            .and_then(|workbook| workbook.try_borrow().ok().and_then(|workbook| workbook.script(script_key).and_then(|script| script.session().try_borrow().ok().map(|session| session.text()))))
            .unwrap_or_default();
        let mut metadata = QueryMetadata::new(QueryType::UserProvided);
        metadata.title = Some("Workbook Query".into());
        metadata.issuer = Some("Query Rerun".into());
        metadata.workbook_id = Some(workbook_id.to_string());
        metadata.result_owner = Some(result_owner(workbook_id, script_key));
        let owner = QueryOwner::Connection(connection_id.to_string());
        let query_id = self.connections.registry.borrow_mut().next_query_id();
        let now = self.platform.now() as i64;
        let state = QueryExecutionState::new(query_id, 0, text, metadata, now);
        let recorded = self.connections.apply_query(&owner, QueryExecutionAction::ExecuteQuery { state: Box::new(state) }, true).and_then(|_| {
            let error = QueryError { message: message.to_string(), details: None };
            self.connections.apply_query(&owner, QueryExecutionAction::QueryFailed { query_id, error, metrics: None, now }, true)
        });
        let registered = recorded.and_then(|_| self.workbooks.apply(workbook_id, WorkbookAction::RegisterQuery { key: script_key, query_id: query_id as u32 }));
        if let Err(error) = registered {
            self.log(LogLevel::Warn, "Failed to show the error of a run on its script", &[("workbookId", workbook_id), ("error", error.what())]);
        }
    }

    /// A run ended: it releases the workbook, a change of inputs that waits may start
    fn release(self: &Rc<Self>, workbook_id: &str, number: u64) {
        self.update_held(workbook_id, number, |entry| entry.held = None);
        self.start_pending();
        // The run wrote the files of its keys, the scripts of other workbooks may share them
        self.forget_cached_results();
    }

    /// Drop a change of inputs that still waits after a while
    fn drop_pending_later(self: &Rc<Self>, workbook_id: &str, generation: u64) {
        let runs = Rc::downgrade(self);
        let sleep = self.platform.sleep(PENDING_INPUTS_MS);
        let workbook_id = workbook_id.to_string();
        self.platform.spawn(Box::pin(async move {
            sleep.await;
            let Some(runs) = runs.upgrade() else { return };
            let waits = runs.read(&workbook_id, |entry| entry.and_then(|entry| entry.pending.as_ref()).is_some_and(|pending| pending.generation == generation));
            if !waits {
                return;
            }
            let dropped = runs.update(&workbook_id, |entry| entry.pending.take()).map(|pending| pending.inputs.join(", ")).unwrap_or_default();
            let reason = runs.scope(&workbook_id).and_then(|scope| runs.blocker(&workbook_id, &scope.connections, false)).unwrap_or_default();
            runs.log(LogLevel::Warn, "Dropped a change of inputs, the workbook stayed busy", &[("workbookId", &workbook_id), ("inputs", &dropped), ("reason", &reason)]);
        }));
    }

    /// Start the changes of inputs whose workbooks are free
    fn start_pending(self: &Rc<Self>) {
        if self.destroyed.get() {
            return;
        }
        let waiting: Vec<String> = self.entries.borrow().iter().filter(|entry| entry.pending.is_some() && entry.held.is_none()).map(|entry| entry.workbook_id.clone()).collect();
        for workbook_id in waiting {
            let Some(scope) = self.scope(&workbook_id) else {
                self.update(&workbook_id, |entry| entry.pending = None);
                continue;
            };
            if self.blocker(&workbook_id, &scope.connections, false).is_some() {
                continue;
            }
            let Some(pending) = self.update(&workbook_id, |entry| entry.pending.take()) else { continue };
            let run = self.run_workbook(&workbook_id, RunWorkbookOptions { inputs: Some(pending.inputs), ..RunWorkbookOptions::default() }, None);
            self.platform.spawn(Box::pin(async move {
                run.await;
            }));
        }
    }

    /// Follow the registry after it changed: stop the runs of workbooks that are gone and of connections that dropped,
    /// start the changes of inputs that wait, read the columns of new attachments
    pub fn follow(self: &Rc<Self>) {
        // What to stop and why, logged once the borrows ended
        let mut stops: Vec<(Rc<RunHandle<RuntimeRunHost>>, &'static str, Vec<(&'static str, String)>)> = Vec::new();
        {
            let entries = self.entries.borrow();
            let registry = self.connections.registry.borrow();
            for entry in entries.iter() {
                let Some(held) = &entry.held else { continue };
                let handle = &held.handle;
                if self.workbooks.get(&entry.workbook_id).is_none() {
                    stops.push((handle.clone(), "Stopping the run of a workbook that is gone", vec![("workbookId", entry.workbook_id.clone())]));
                    continue;
                }
                let health = |id: &str| registry.get(id).and_then(|connection| connection.state.try_borrow().ok().map(|state| state.health()));
                if let Some(dropped) = held.online.iter().find(|id| health(id) != Some(ConnectionHealth::Online)) {
                    let health = health(dropped).map(|health| format!("{health:?}")).unwrap_or_else(|| "gone".into());
                    let details = vec![("workbookId", entry.workbook_id.clone()), ("connectionId", dropped.clone()), ("health", health)];
                    stops.push((handle.clone(), "Stopping the run of a workbook, a connection it runs statements on dropped", details));
                }
            }
        }
        for (handle, message, details) in stops {
            let details: Vec<(&str, &str)> = details.iter().map(|(key, value)| (*key, value.as_str())).collect();
            self.log(LogLevel::Info, message, &details);
            handle.cancel();
        }
        // The slices of the workbooks that are gone go with them
        let gone = {
            let mut entries = self.entries.borrow_mut();
            let before = entries.len();
            entries.retain(|entry| entry.held.is_some() || self.workbooks.get(&entry.workbook_id).is_some());
            before != entries.len()
        };
        if gone {
            self.platform.changed(Slice::Runs, true);
        }
        self.start_pending();
        self.describe_attachments();
    }

    /// Stop the run of a workbook
    pub fn stop(&self, workbook_id: &str) {
        let handle = self.read(workbook_id, |entry| entry.and_then(|entry| entry.held.as_ref()).map(|held| held.handle.clone()));
        if let Some(handle) = handle {
            handle.cancel();
        }
    }

    /// Stop every run, e.g. when the runtime is destroyed. The changes of inputs that wait are dropped.
    pub fn stop_all(&self) {
        self.destroyed.set(true);
        let (handles, dropped) = {
            let mut entries = self.entries.borrow_mut();
            let mut dropped = false;
            for entry in entries.iter_mut().filter(|entry| entry.pending.is_some()) {
                entry.pending = None;
                entry.revision = next_revision();
                dropped = true;
            }
            let handles: Vec<Rc<RunHandle<RuntimeRunHost>>> = entries.iter().filter_map(|entry| entry.held.as_ref().map(|held| held.handle.clone())).collect();
            (handles, dropped)
        };
        if dropped {
            self.platform.changed(Slice::Runs, true);
        }
        for handle in handles {
            handle.cancel();
        }
    }

    /// The state of the run of a workbook changed, a run that no longer holds the workbook changes nothing
    fn set_state(&self, workbook_id: &str, number: u64, state: WorkbookRunState) {
        let changed = self.read(workbook_id, |entry| entry.and_then(|entry| entry.state.as_ref()) != Some(&state));
        if changed {
            self.update_held(workbook_id, number, |entry| entry.state = Some(state));
        }
    }

    /// The revisions of the slices of the runs by workbook, none while a task holds them
    pub fn revisions(&self) -> Option<Vec<(String, u64)>> {
        let entries = self.entries.try_borrow().ok()?;
        Some(entries.iter().map(|entry| (entry.workbook_id.clone(), entry.revision)).collect())
    }

    /// The view of the runs of a workbook
    pub fn view(&self, workbook_id: &str) -> Read<WorkbookRunView> {
        let Ok(entries) = self.entries.try_borrow() else { return Read::Busy };
        let Some(entry) = entries.iter().find(|entry| entry.workbook_id == workbook_id) else { return Read::Gone };
        Read::Value(WorkbookRunView {
            workbook_id: entry.workbook_id.clone(),
            held: entry.held.as_ref().map(|held| held.kind),
            state: entry.state.clone(),
            pending_inputs: entry.pending.as_ref().map(|pending| pending.inputs.clone()).unwrap_or_default(),
        })
    }

    /// Tests of the seam: call a function while the runs are borrowed. None if they are held.
    pub fn hold<R>(&self, f: impl FnOnce() -> R) -> Option<R> {
        let _held = self.entries.try_borrow_mut().ok()?;
        Some(f())
    }

    /// Read the columns of the Parquet attachments without columns once per file and stamp, with the compute database.
    /// A read that fails is tried again with the next call.
    pub fn describe_attachments(self: &Rc<Self>) {
        if !self.platform.has_mounts() {
            return;
        }
        let mut new: Vec<(String, String, String)> = Vec::new();
        {
            let entries = self.workbooks.entries.borrow();
            let mut described = self.described.borrow_mut();
            // The files of workbooks that are gone are forgotten
            described.retain(|key| key.split_once('/').is_some_and(|(id, _)| entries.iter().any(|entry| entry.id == id)));
            for entry in entries.iter() {
                let Ok(workbook) = entry.workbook.try_borrow() else { continue };
                for attachment in workbook.attachments().unwrap_or_default() {
                    if attachment.columns.is_some() {
                        continue;
                    }
                    let stamp = attachment.stamp();
                    if described.insert(format!("{}/{}@{stamp}", entry.id, attachment.file_name)) {
                        new.push((entry.id.clone(), attachment.file_name.clone(), stamp));
                    }
                }
            }
        }
        for (workbook_id, file_name, stamp) in new {
            let read = self.platform.mounts_call("attachmentColumns", &[JsValue::from_str(&workbook_id), JsValue::from_str(&file_name)]);
            let workbooks = Rc::downgrade(&self.workbooks);
            let runs = Rc::downgrade(self);
            let platform = self.platform.clone();
            self.platform.spawn(Box::pin(async move {
                let read = read.await.and_then(|columns| {
                    if !Array::is_array(&columns) {
                        return Err(HostError::new("the columns of an attachment are no list"));
                    }
                    Ok(Array::from(&columns).iter().filter_map(|column| column.as_string()).map(std::sync::Arc::<str>::from).collect::<Vec<_>>())
                });
                let Some(workbooks) = workbooks.upgrade() else { return };
                match read {
                    Ok(columns) => {
                        let action = WorkbookAction::SetAttachmentColumns { file_name: file_name.clone(), stamp, columns };
                        if let Err(error) = workbooks.apply(&workbook_id, action) {
                            let details = [("workbookId", workbook_id.as_str()), ("fileName", file_name.as_str()), ("error", error.what())];
                            platform.log_on(LogLevel::Warn, "Setting the columns of an attachment failed", &details, LOG_TARGET);
                        }
                    }
                    Err(error) => {
                        let details = [("workbookId", workbook_id.as_str()), ("fileName", file_name.as_str()), ("error", error.message())];
                        platform.log_on(LogLevel::Warn, "Reading the columns of an attachment failed", &details, LOG_TARGET);
                        // The next call reads the file again
                        if let Some(runs) = runs.upgrade() {
                            runs.described.borrow_mut().remove(&format!("{workbook_id}/{file_name}@{stamp}"));
                        }
                    }
                }
            }));
        }
    }

    /// The reusable result keys of the scripts of a workbook in feed order, the keys that a run reads and writes. A
    /// script without a reusable key has none, all have none if the analyses as they are can't be planned. Plans the
    /// targets with what they need, every script without, and analyzes nothing.
    pub fn result_keys(&self, workbook_id: &str, targets: Option<Vec<u32>>) -> Result<LocalFuture<Vec<Option<String>>>, String> {
        let workbook = self.workbooks.get(workbook_id).ok_or_else(|| format!("no workbook registered with id {workbook_id}"))?;
        let (graph, scripts) = {
            let workbook = workbook.try_borrow().map_err(|_| "the workbook is busy".to_string())?;
            let request = RunPlanRequest { targets: targets.as_deref(), mount_prefix: "/mnt/external/dashql-keys", ..RunPlanRequest::default() };
            let scripts: Vec<String> = workbook.scripts().iter().map(|script| script.connection().connection_id.clone()).collect();
            (workbook.plan_run(&request), scripts)
        };
        let caches: Vec<bool> = {
            let registry = self.connections.registry.borrow();
            scripts.iter().map(|id| registry.get(id).is_some_and(|connection| connection.state.try_borrow().is_ok_and(|state| state.caches_query_results()))).collect()
        };
        let connections = self.connections.clone();
        let scripts = Rc::new(scripts);
        Ok(Box::pin(async move {
            if !graph.valid {
                return scripts.iter().map(|_| None).collect();
            }
            let key_scripts = scripts.clone();
            let keys = result_keys(
                &graph,
                move |script, signature| connections.result_key(key_scripts.get(script as usize).map(String::as_str).unwrap_or_default(), &signature),
                |script| caches.get(script as usize).copied().unwrap_or(false),
            )
            .await;
            keys.into_iter().map(|key| key.filter(|key| key.reusable).map(|key| key.key)).collect()
        }))
    }
}

/// A function member of a JS object
fn member_function(object: &JsValue, name: &str) -> Option<Function> {
    if !object.is_object() {
        return None;
    }
    Reflect::get(object, &JsValue::from_str(name)).ok().and_then(|member| member.dyn_into::<Function>().ok())
}

/// The host of a run of a workbook on the runtime: the statements run on its executor, the files of the run are files of
/// the platform, the state goes into the slice of the workbook and the events of the scripts to the listener
pub(crate) struct RuntimeRunHost {
    runs: Weak<Runs>,
    platform: JsPlatform,
    connections: Rc<Connections>,
    workbooks: Weak<Workbooks>,
    workbook: Weak<RefCell<Workbook>>,
    workbook_id: String,
    /// The number of the run, the platform names the files of the run by it
    number: u64,
    /// The connections that statements run on, every connection without
    can_run: Option<Vec<String>>,
    /// Hears the events of the scripts and prepares the connections
    listener: Option<JsValue>,
    prepares: bool,
    /// The names of the files of keys that the run writes, the cache keeps its limits after each
    keyed_files: RefCell<BTreeSet<String>>,
}

impl RuntimeRunHost {
    fn number(&self) -> JsValue {
        JsValue::from_f64(self.number as f64)
    }

    /// The state of a connection of the runtime
    fn with_connection<R>(&self, connection_id: &str, read: impl FnOnce(&ConnectionState) -> R) -> Option<R> {
        let registry = self.connections.registry.borrow();
        let connection = registry.get(connection_id)?;
        let state = connection.state.try_borrow().ok()?;
        Some(read(&state))
    }
}

impl Host for RuntimeRunHost {
    fn now(&self) -> f64 {
        self.platform.now()
    }

    fn sleep(&self, ms: f64) -> impl Future<Output = ()> + 'static {
        self.platform.sleep(ms)
    }

    fn spawn(&self, task: LocalTask) {
        self.platform.spawn(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        self.platform.log_on(level, message, details, LOG_TARGET);
    }
}

impl RunHost for RuntimeRunHost {
    fn execute(&self, request: StatementRequest) -> Result<StatementHandle, StatementFailure> {
        let planned = &request.planned;
        let mut metadata = QueryMetadata::new(QueryType::UserProvided);
        metadata.title = Some(planned.title());
        metadata.description = Some(planned.description());
        metadata.issuer = Some(planned.issuer());
        metadata.workbook_id = Some(self.workbook_id.clone());
        metadata.result_owner = Some(result_owner(&self.workbook_id, request.script_key));
        metadata.planned = Some(planned.to_json());
        let cache = match request.cache {
            StatementCache::None => None,
            StatementCache::Refresh { signature } => Some((signature, true, false)),
            StatementCache::Only { signature } => Some((signature, false, true)),
        };
        let client_function_call = request.client_function_call.as_deref().and_then(|call| serde_json::from_str(call).ok());
        let statement = Statement {
            connection_id: request.connection_id,
            text: request.text,
            metadata,
            client_function_call,
            analyze_results: request.analyze_results,
            publish_results: request.publish_results,
            cache,
        };
        let (query_id, ready, done) = self.connections.run_statement(statement);
        Ok(StatementHandle {
            query_id,
            ready,
            done: Box::pin(async move {
                done.await.map_err(|failure| StatementFailure {
                    message: failure.message.clone(),
                    cache_miss: failure.kind == FailureKind::CacheMiss,
                    value: Some(Rc::new(StatementError { query_id, failure })),
                })
            }),
        })
    }

    fn cancel(&self, _connection_id: &str, query_id: QueryId) -> impl Future<Output = ()> + 'static {
        self.connections.cancel(query_id)
    }

    fn result_key(&self, connection_id: &str, signature: &str) -> impl Future<Output = Option<String>> + 'static {
        self.connections.result_key(connection_id, signature)
    }

    fn caches_results(&self, connection_id: &str) -> bool {
        self.with_connection(connection_id, |state| state.caches_query_results()).unwrap_or(false)
    }

    fn can_run(&self, connection_id: &str) -> bool {
        self.can_run.as_ref().is_none_or(|online| online.iter().any(|id| id == connection_id))
    }

    fn max_concurrent_queries(&self, connection_id: &str) -> usize {
        self.with_connection(connection_id, max_concurrent_queries).unwrap_or(1)
    }

    fn prepares_connections(&self) -> bool {
        self.prepares
    }

    fn prepare_connection(&self, connection_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = match self.listener.as_ref().and_then(|listener| member_function(listener, "prepareConnection").map(|prepare| (listener, prepare))) {
            Some((listener, prepare)) => prepare.call1(listener, &JsValue::from_str(connection_id)).map_err(host_error),
            None => Err(HostError::new("the run prepares no connections")),
        };
        async move {
            JsFuture::from(Promise::resolve(&call?)).await.map_err(host_error)?;
            Ok(())
        }
    }

    fn has_cache(&self) -> bool {
        self.platform.has_cache()
    }

    fn cache_retain(&self, key: &str) -> impl Future<Output = Result<Option<RetainedFile>, HostError>> + 'static {
        let retain = self.platform.cache_retain(key);
        async move { Ok(retain.await?.map(|(id, name)| RetainedFile { id, name })) }
    }

    fn cache_release(&self, file: u64) -> impl Future<Output = ()> + 'static {
        self.platform.cache_release(file)
    }

    fn mount_prefix(&self) -> Option<String> {
        self.platform.mounts_call_now("prefix", &[]).ok().and_then(|prefix| prefix.as_string())
    }

    fn mount_file_name(&self, key: Option<&str>) -> String {
        let keyed = key.is_some();
        let key = key.map(JsValue::from_str).unwrap_or(JsValue::NULL);
        let name = self.platform.mounts_call_now("fileName", &[self.number(), key]).ok().and_then(|name| name.as_string()).unwrap_or_default();
        if keyed && !name.is_empty() {
            self.keyed_files.borrow_mut().insert(name.clone());
        }
        name
    }

    fn mount_write(&self, path: &str, query_id: QueryId) -> impl Future<Output = Result<u64, HostError>> + 'static {
        // The result table of the statement is the one of its query in the history of its connection
        let table = {
            let registry = self.connections.registry.borrow();
            registry.query_history(query_id).and_then(|(_, history)| history.try_borrow().ok().and_then(|history| history.query(query_id).and_then(|query| query.result_table.as_ref().map(|table| table.id))))
        };
        let write = table.map(|table| self.platform.mounts_call("write", &[self.number(), JsValue::from_str(path), JsValue::from_f64(table as f64)]));
        // The cache keeps its limits after every file of a key, a transient file of the run goes when the run ends
        let keyed = self.keyed_files.borrow().iter().any(|name| path.rsplit('/').next() == Some(name.as_str()));
        let evict = keyed.then(|| self.platform.evict_cache());
        async move {
            let Some(write) = write else { return Err(HostError::new("The statement has no result")) };
            let rows = write.await?.as_f64().unwrap_or_default().max(0.0) as u64;
            if let Some(evict) = evict {
                evict.await;
            }
            Ok(rows)
        }
    }

    fn mount_use(&self, path: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.platform.mounts_call("use", &[self.number(), JsValue::from_str(path)]);
        async move { call.await.map(|_| ()) }
    }

    fn mount_release(&self) -> impl Future<Output = ()> + 'static {
        let call = self.platform.mounts_call("release", &[self.number()]);
        async move {
            let _ = call.await;
        }
    }

    fn mounts_attachments(&self) -> bool {
        self.platform.has_mounts()
    }

    fn mount_attachments(&self) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.platform.mounts_call("attachments", &[JsValue::from_str(&self.workbook_id)]);
        async move { call.await.map(|_| ()) }
    }

    fn workbook_live(&self) -> bool {
        match (self.workbooks.upgrade(), self.workbook.upgrade()) {
            (Some(workbooks), Some(held)) => workbooks.get(&self.workbook_id).is_some_and(|current| Rc::ptr_eq(&current, &held)),
            _ => false,
        }
    }

    fn workbook_changed(&self, effects: Vec<WorkbookEffect>, analyzed: bool) {
        if let Some(workbooks) = self.workbooks.upgrade() {
            workbooks.settle_run(&self.workbook_id, effects, analyzed);
        }
    }

    fn state(&self, state: &RunState) {
        if let Some(runs) = self.runs.upgrade() {
            runs.set_state(&self.workbook_id, self.number, WorkbookRunState::from(state));
        }
    }

    fn script_event(&self, file: &str, event: &ScriptEvent) {
        let Some((listener, script)) = self.listener.as_ref().and_then(|listener| member_function(listener, "script").map(|script| (listener, script))) else {
            return;
        };
        let (view, error) = WorkbookScriptRunEvent::of(event);
        let Ok(view) = super::views_to_js(&view) else { return };
        // A listener that throws changes nothing
        let _ = script.call3(listener, &JsValue::from_str(file), &view, &error);
    }

    fn cooperate(&self) -> impl Future<Output = ()> + 'static {
        self.platform.sleep(0.0)
    }
}
