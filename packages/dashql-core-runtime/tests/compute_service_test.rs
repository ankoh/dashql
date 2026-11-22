// The tasks of the computations on a fake compute host: an executor of a single thread and a compute database in
// memory. The database doesn't run SQL, a test answers the SELECT of a task with a table by the title of the task.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::future::Future;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Wake, Waker};

use arrow_array::types::Int32Type;
use arrow_array::{ArrayRef, Float64Array, Int64Array, ListArray, RecordBatch, StringArray};
use dashql_core::error::Result;
use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, KeptTable, RunId, TableShape};
use dashql_core_runtime::compute::service::{AnalysisHandles, ComputeService, TaskOutput};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::OrderByConstraint;
use dashql_core_runtime::compute::types::{
    ColumnAggregate, ColumnGroup, ColumnSummaryAnalysis, ComputationTask, DataSearchColumn, DataSearchTask, FilterOp,
    ScalarFilter, TableFilteringTask, TaskStatus,
};
use dashql_core_runtime::compute::{ComputationAction, ComputationEffect, ComputationOutcome, SearchKind};
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::settings::RuntimeSettings;

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

// The compute database

/// Answers the SELECT of a task with a table, by the title of the task and the SQL
type Answer = Box<dyn Fn(&str, &str) -> std::result::Result<ResultTable, String>>;

#[derive(Default)]
struct Database {
    /// The tables by name
    tables: BTreeMap<String, ResultTable>,
    /// The calls, in order
    calls: Vec<String>,
    /// The queries, in order
    queries: Vec<String>,
    /// The runs that the service cancelled
    cancelled: Vec<RunId>,
    /// The runs that created tables, in order
    runs: Vec<RunId>,
    /// The effects of the changes that the tasks reported
    changes: Vec<Vec<ComputationEffect>>,
    /// Holds the next creation of a table of a title until the test releases it
    gates: BTreeMap<&'static str, Receiver<()>>,
    /// The titles whose creations of tables the host cancels, e.g. a compute database that went away
    cancels: BTreeSet<&'static str>,
    /// The handles that the host keeps: the tables that the tasks handed over and the ones of the analyses
    handles: BTreeSet<u32>,
    /// The tables of the handles that the host keeps as tables: the results and the tables that the tasks read
    objects: BTreeMap<u32, ResultTable>,
    /// The tables that the tasks read and parsed in the module, by the SQL of the read
    parsed: Vec<String>,
    /// The next handle
    next_handle: u32,
}

impl Database {
    /// A new handle
    fn handle(&mut self) -> u32 {
        self.next_handle += 1;
        let handle = 1000 + self.next_handle;
        self.handles.insert(handle);
        handle
    }

    /// Keep a table under a new handle
    fn keep(&mut self, table: ResultTable) -> u32 {
        let handle = self.handle();
        self.objects.insert(handle, table);
        handle
    }

    /// Release the handles of effects, like the host
    fn release(&mut self, effects: &[ComputationEffect]) {
        for effect in effects {
            if let ComputationEffect::Release { handle } = effect {
                self.handles.remove(handle);
                self.objects.remove(handle);
            }
        }
    }
}

struct FakeHost {
    executor: Rc<Executor>,
    clock: Cell<f64>,
    database: Rc<RefCell<Database>>,
    answer: Answer,
}

impl Host for FakeHost {
    fn now(&self) -> f64 {
        let now = self.clock.get() + 1.0;
        self.clock.set(now);
        now
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

/// The table that a read names
fn read_table(sql: &str) -> Option<String> {
    let start = sql.find("\"__df_")? + 1;
    let end = start + sql.get(start..)?.find('"')?;
    sql.get(start..end).map(str::to_string)
}

/// A call of the database without the data frame that it names, the ids depend on how many the runtime allocated
fn without_data_frame(call: &str) -> String {
    call.split(' ').filter(|part| !part.starts_with("__df_")).collect::<Vec<_>>().join(" ")
}

/// The data frame that a call of the database names
fn data_frame_of(call: &str) -> Option<u64> {
    call.split(' ').find_map(|part| part.strip_prefix("__df_")).and_then(|id| id.parse().ok())
}

impl ComputeHost for FakeHost {
    async fn import_table(
        &self,
        _data_frame: u64,
        table_name: &str,
        table: u32,
        row_number_field: &str,
        _context: &ComputeContext,
    ) -> std::result::Result<(), HostError> {
        let mut database = self.database.borrow_mut();
        let table = database.objects.get(&table).ok_or_else(|| HostError::new(format!("no table {table}")))?;
        // The host numbers the rows of its table
        let table = table.append_row_numbers(row_number_field).map_err(|e| HostError::new(e.to_string()))?;
        database.calls.push(format!("import {table_name}"));
        database.tables.insert(table_name.to_string(), table);
        Ok(())
    }

    async fn create_table(
        &self,
        _data_frame: u64,
        table_name: &str,
        sql: &str,
        context: &ComputeContext,
    ) -> std::result::Result<(), HostError> {
        self.database.borrow_mut().calls.push(format!("create {table_name} ({})", context.title));
        self.database.borrow_mut().runs.push(context.run);
        let gate = self.database.borrow_mut().gates.remove(context.title);
        if let Some(gate) = gate {
            gate.await;
        }
        if self.database.borrow().cancels.contains(context.title) {
            return Err(HostError::cancelled());
        }
        let table = (self.answer)(context.title, sql).map_err(HostError::new)?;
        self.database.borrow_mut().tables.insert(table_name.to_string(), table);
        Ok(())
    }

    async fn query(&self, sql: &str, _context: &ComputeContext) -> std::result::Result<Vec<u8>, HostError> {
        self.database.borrow_mut().queries.push(sql.to_string());
        // The search of the column names reads no table, it matches the column group of the name
        if sql.contains("AS columns(column_idx") {
            let matches = table(vec![
                ("column_idx", a(Int64Array::from(vec![1]))),
                ("column_group_idx", a(Int64Array::from(vec![2]))),
            ]);
            return matches.to_ipc_stream().map_err(|e| HostError::new(e.to_string()));
        }
        if sql.starts_with("SELECT count(*)") {
            let count = table(vec![("count", a(Int64Array::from(vec![1])))]);
            return count.to_ipc_stream().map_err(|e| HostError::new(e.to_string()));
        }
        let name = read_table(sql).ok_or_else(|| HostError::new(format!("no table in {sql}")))?;
        let mut database = self.database.borrow_mut();
        database.parsed.push(sql.to_string());
        let table = database.tables.get(&name).ok_or_else(|| HostError::new(format!("no table {name}")))?;
        table.to_ipc_stream().map_err(|e| HostError::new(e.to_string()))
    }

    async fn query_table(&self, sql: &str, _context: &ComputeContext) -> std::result::Result<KeptTable, HostError> {
        self.database.borrow_mut().queries.push(sql.to_string());
        let name = read_table(sql).ok_or_else(|| HostError::new(format!("no table in {sql}")))?;
        let mut database = self.database.borrow_mut();
        let table = database.tables.get(&name).cloned().ok_or_else(|| HostError::new(format!("no table {name}")))?;
        let shape = shape(&table);
        Ok(KeptTable { handle: database.keep(table), shape })
    }

    async fn drop_table(&self, _data_frame: u64, table_name: &str) -> std::result::Result<(), HostError> {
        let mut database = self.database.borrow_mut();
        database.calls.push(format!("drop {table_name}"));
        database.tables.remove(table_name);
        Ok(())
    }

    fn register_table(&self, ipc: &[u8]) -> std::result::Result<u32, HostError> {
        ResultTable::from_ipc_stream(ipc).map_err(|e| HostError::new(e.to_string()))?;
        Ok(self.database.borrow_mut().handle())
    }

    fn release(&self, handle: u32) {
        let mut database = self.database.borrow_mut();
        database.handles.remove(&handle);
        database.objects.remove(&handle);
    }

    fn cancel(&self, run: RunId) {
        self.database.borrow_mut().cancelled.push(run);
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        let mut database = self.database.borrow_mut();
        database.release(effects);
        database.changes.push(effects.to_vec());
    }
}

// Tables

fn a<T: arrow_array::Array + 'static>(array: T) -> ArrayRef {
    Arc::new(array)
}

/// What the runtime knows of a table of the host
fn shape(table: &ResultTable) -> TableShape {
    TableShape { rows: table.num_rows() as u64, schema: table.schema().clone() }
}

fn table(columns: Vec<(&str, ArrayRef)>) -> ResultTable {
    ResultTable::from_batch(RecordBatch::try_from_iter(columns).unwrap())
}

/// The result of the tests: a score and a name
fn result() -> ResultTable {
    table(vec![
        ("score", a(Float64Array::from(vec![Some(42.0), Some(10.0), None, Some(30.0)]))),
        ("name", a(StringArray::from(vec![Some("a"), Some("b"), Some("a"), None]))),
    ])
}

/// What the compute database answers the tasks of the analysis of the result with
fn analysis_answer(title: &str, sql: &str) -> std::result::Result<ResultTable, String> {
    match title {
        "Table aggregation" => Ok(table(vec![
            ("_count", a(Int64Array::from(vec![4]))),
            ("_0_count", a(Int64Array::from(vec![3]))),
            ("_0_min", a(Float64Array::from(vec![10.0]))),
            ("_0_max", a(Float64Array::from(vec![42.0]))),
            ("_1_count", a(Int64Array::from(vec![3]))),
            ("_1_countd", a(Int64Array::from(vec![2]))),
        ])),
        "System column computation" => result().append_row_numbers("_rownum").map_err(|e| e.to_string()),
        "Column aggregation" if sql.contains("binLowerBound") => Ok(table(vec![
            ("bin", a(Int64Array::from(vec![Some(0), Some(15), None]))),
            ("count", a(Int64Array::from(vec![2, 1, 1]))),
            ("binLowerBound", a(Float64Array::from(vec![Some(10.0), Some(40.0), None]))),
        ])),
        "Column aggregation" => Ok(table(vec![
            ("key", a(StringArray::from(vec![Some("a"), Some("b"), None]))),
            ("keyId", a(Int64Array::from(vec![1, 2, 3]))),
            ("count", a(Int64Array::from(vec![2, 1, 1]))),
        ])),
        "Table filtering" => Ok(table(vec![("_rownum", a(Int64Array::from(vec![1, 4])))])),
        "Table ordering" => Ok(table(vec![("_rownum", a(Int64Array::from(vec![2, 4, 1, 3])))])),
        "Filtered column aggregation" if sql.contains("binLowerBound") => Ok(table(vec![
            ("bin", a(Int64Array::from(vec![Some(0), Some(15), None]))),
            ("count", a(Int64Array::from(vec![1, 1, 0]))),
            ("binLowerBound", a(Float64Array::from(vec![Some(10.0), Some(40.0), None]))),
        ])),
        "Data search" => Ok(table(vec![
            ("row_idx", a(Int64Array::from(vec![1]))),
            ("column_indices", a(ListArray::from_iter_primitive::<Int32Type, _, _>(vec![Some(vec![Some(0)])]))),
        ])),
        other => Err(format!("no answer for {other}")),
    }
}

struct Setup {
    executor: Rc<Executor>,
    database: Rc<RefCell<Database>>,
    service: ComputeService<FakeHost>,
}

fn setup(answer: impl Fn(&str, &str) -> std::result::Result<ResultTable, String> + 'static) -> Setup {
    let executor = Rc::new(Executor::default());
    let database = Rc::new(RefCell::new(Database::default()));
    let host = FakeHost {
        executor: executor.clone(),
        clock: Cell::new(1000.0),
        database: database.clone(),
        answer: Box::new(answer),
    };
    Setup { executor, database, service: ComputeService::new(host) }
}

impl Setup {
    /// Run a future on the executor until it stalls, returns its output if it finished
    fn run<T: 'static>(&self, future: impl Future<Output = T> + 'static) -> Rc<RefCell<Option<T>>> {
        let output = Rc::new(RefCell::new(None));
        let slot = output.clone();
        self.executor.spawn(Box::pin(async move {
            *slot.borrow_mut() = Some(future.await);
        }));
        self.executor.run_until_stalled();
        output
    }

    /// The handles of the result of the tests and the lifetime of an analysis
    fn analysis_handles(&self) -> AnalysisHandles {
        let mut database = self.database.borrow_mut();
        AnalysisHandles { table: database.keep(result()), lifetime: database.handle() }
    }

    /// Apply an action of the host and release the handles of its effects
    fn apply(&self, action: ComputationAction) -> ComputationOutcome {
        let outcome = self.service.apply(action).unwrap();
        self.database.borrow_mut().release(&outcome.effects);
        outcome
    }

    fn analyze(&self) -> Result<()> {
        let handles = self.analysis_handles();
        let analysis = self.service.analyze_table(
            1,
            shape(&result()),
            handles,
            Some("connection".into()),
            None,
            AnalyzeTableOptions::default(),
        );
        let output = self.run(analysis);
        let output = output.borrow_mut().take();
        output.expect("the analysis finished")
    }

    /// The tables of the database that hold data frames
    fn data_frame_tables(&self) -> BTreeSet<String> {
        self.database.borrow().tables.keys().cloned().collect()
    }

    /// The tables of the data frames of the state
    fn state_data_frame_tables(&self) -> BTreeSet<String> {
        self.service.read(|state| state.data_frames().into_iter().map(|id| format!("__df_{id}")).collect())
    }

    fn schedule(&self, task: ComputationTask) -> u64 {
        let outcome = self.service.apply(ComputationAction::ScheduleTask { task, now: 0 }).unwrap();
        outcome.task_id.expect("a scheduled task")
    }
}

#[test]
fn analyzes_a_result() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let calls = setup.database.borrow().calls.clone();
    // The analysis imports the result, then computes the statistics, the system columns and a summary per column
    let steps: Vec<String> = calls.iter().map(|call| without_data_frame(call)).collect();
    assert_eq!(
        steps,
        [
            "import",
            "create (Table aggregation)",
            "create (System column computation)",
            "create (Column aggregation)",
            "create (Column aggregation)"
        ]
    );
    // The data frames that the analysis created are those of the state
    let created: Vec<u64> =
        calls.iter().filter(|call| call.starts_with("create ")).filter_map(|c| data_frame_of(c)).collect();
    let (statistics, system_columns, mut summaries) = setup.service.read(|state| {
        let computation = state.computation(1).expect("a computation");
        let summaries: Vec<u64> = computation
            .column_aggregates
            .iter()
            .flatten()
            .filter_map(|aggregate| match aggregate {
                ColumnAggregate::Ordinal(summary)
                | ColumnAggregate::String(summary)
                | ColumnAggregate::List(summary) => Some(summary.data_frame),
                _ => None,
            })
            .collect();
        let statistics = computation.table_aggregation.as_ref().expect("the statistics").data_frame;
        (statistics, computation.data_frame.expect("the system columns"), summaries)
    });
    assert_eq!(created[..2], [statistics, system_columns]);
    let mut created_summaries = created[2..].to_vec();
    created_summaries.sort();
    summaries.sort();
    assert_eq!(created_summaries, summaries);
    // The module parses the statistics and the summaries only: the result and the system columns stay with the host
    let mut parsed: Vec<Option<String>> = setup.database.borrow().parsed.iter().map(|sql| read_table(sql)).collect();
    let mut small: Vec<Option<String>> =
        [statistics].iter().chain(summaries.iter()).map(|id| Some(format!("__df_{id}"))).collect();
    parsed.sort();
    small.sort();
    assert_eq!(parsed, small);
    setup.service.read(|state| {
        let computation = state.computation(1).expect("a computation");
        assert_eq!(computation.connection_id.as_deref(), Some("connection"));
        assert_eq!(computation.row_number_column_name.as_deref(), Some("_rownum"));
        assert_eq!(computation.data_table.rows(), 4);
        let aggregation = computation.table_aggregation.as_ref().expect("the statistics");
        assert_eq!(aggregation.table.rows(), 1);
        // The row numbers come first, then the score and the name
        assert!(matches!(computation.column_groups.first(), Some(ColumnGroup::RowNumber(_))));
        let Some(Some(ColumnAggregate::Ordinal(score))) = computation.column_aggregates.get(1) else {
            panic!("the histogram of the score")
        };
        let Some(ColumnSummaryAnalysis::Ordinal(analysis)) = score.analysis.as_deref() else { panic!("an analysis") };
        assert_eq!((analysis.total_count, analysis.count_null, analysis.count_not_null), (4, 1, 3));
        assert_eq!(analysis.bin_value_counts.first(), Some(&2));
        let Some(Some(ColumnAggregate::String(name))) = computation.column_aggregates.get(2) else {
            panic!("the frequent values of the name")
        };
        let Some(ColumnSummaryAnalysis::String(analysis)) = name.analysis.as_deref() else { panic!("an analysis") };
        assert_eq!(analysis.frequent_value_strings, vec![Some("a".to_string()), Some("b".to_string()), None]);
        assert_eq!((analysis.count_distinct, analysis.is_unique), (2, false));
        assert!(computation
            .tasks
            .column_aggregation
            .iter()
            .flatten()
            .all(|t| t.progress.status == TaskStatus::Succeeded));
        assert_eq!(computation.tasks.system_columns.as_ref().map(|t| t.progress.status), Some(TaskStatus::Succeeded));
        assert_eq!(state.scheduler_tasks().count(), 0);
    });
    // The database holds the data frames of the state
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
    assert!(!setup.database.borrow().changes.is_empty());
}

#[test]
fn a_result_without_columns_has_nothing_to_analyze() {
    let setup = setup(analysis_answer);
    let empty = ResultTable::try_new(Arc::new(arrow_schema::Schema::empty()), Vec::new()).unwrap();
    let handles = setup.analysis_handles();
    let output =
        setup.run(setup.service.analyze_table(1, shape(&empty), handles, None, None, AnalyzeTableOptions::default()));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(()))));
    assert!(setup.service.read(|state| state.computation(1).is_none()));
    assert!(setup.database.borrow().calls.is_empty());
    // The analysis didn't take the handles
    assert!(setup.database.borrow().handles.is_empty());
}

#[test]
fn the_tables_of_an_analysis_stay_with_the_host_and_go_with_the_computation() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    // The host keeps the tables that the state holds (the statistics, the system columns, two summaries) and the
    // lifetime, nothing else
    setup.executor.run_until_stalled();
    let held = setup.service.read(|state| state.arrow_tables());
    assert!(held.len() >= 4);
    let lifetime = setup.service.read(|state| state.computation(1).map(|computation| computation.lifetime)).unwrap();
    let mut expected = held.clone();
    expected.insert(lifetime);
    assert_eq!(setup.database.borrow().handles, expected);
    let outcome = setup.apply(ComputationAction::DeleteComputation { table_id: 1 });
    assert!(outcome.effects.iter().any(|effect| matches!(effect, ComputationEffect::Abort { .. })));
    setup.executor.run_until_stalled();
    assert!(setup.database.borrow().handles.is_empty());
}

#[test]
fn a_failed_task_drops_its_data_frame() {
    let setup = setup(|title, sql| match title {
        "Column aggregation" => Err("the engine failed".into()),
        _ => analysis_answer(title, sql),
    });
    let error = setup.analyze().unwrap_err();
    assert!(error.to_string().contains("Computing column aggregate failed: the engine failed"), "{error}");
    setup.executor.run_until_stalled();
    // A data frame of a summary is dropped
    let calls = setup.database.borrow().calls.clone();
    let summaries: Vec<u64> =
        calls.iter().filter(|call| call.ends_with("(Column aggregation)")).filter_map(|c| data_frame_of(c)).collect();
    let dropped: Vec<u64> =
        calls.iter().filter(|call| call.starts_with("drop ")).filter_map(|c| data_frame_of(c)).collect();
    assert!(dropped.iter().any(|id| summaries.contains(id)), "{calls:?}");
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        let failed = computation.tasks.column_aggregation.get(1).and_then(Option::as_ref).expect("the task");
        assert_eq!(failed.progress.status, TaskStatus::Failed);
        assert!(failed.progress.failed_with_error.as_deref().unwrap_or_default().contains("the engine failed"));
        assert_eq!(state.scheduler_tasks().count(), 0);
    });
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn filters_the_rows_of_an_analyzed_result() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let (table_version, data_table, data_frame) = setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        (computation.version, computation.data_table.clone(), computation.data_frame.unwrap())
    });
    let filtering = |value: f64| {
        ComputationTask::TableFiltering(TableFilteringTask {
            table_id: 1,
            table_version,
            input_data_table: data_table.clone(),
            input_data_frame: data_frame,
            row_number_column_name: "_rownum".into(),
            filters: vec![ScalarFilter { field_name: "_1_bin".into(), op: FilterOp::GreaterEqual, value }],
        })
    };
    let task = setup.schedule(filtering(1.0));
    let output = setup.run(setup.service.run_task(task));
    let Some(Ok(TaskOutput::Filtering(Some(filter)))) = output.borrow_mut().take() else { panic!("a filter") };
    assert_eq!(filter.table.rows(), 2);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert_eq!(computation.filter_table.as_ref().map(|f| f.table.id), Some(filter.table.id));
        assert_eq!(computation.tasks.filtering.as_ref().map(|t| t.progress.status), Some(TaskStatus::Succeeded));
    });

    // A filter of an older filter version is stale, the state drops it and the service its data frame
    let stale = setup.schedule(filtering(2.0));
    let newer = setup.schedule(filtering(3.0));
    let output = setup.run(setup.service.run_task(stale));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(TaskOutput::Filtering(Some(_))))));
    setup.executor.run_until_stalled();
    let output = setup.run(setup.service.run_task(newer));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(TaskOutput::Filtering(Some(_))))));
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn a_new_data_search_cancels_the_running_one() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let (table_version, data_frame) = setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        (computation.version, computation.data_frame.unwrap())
    });
    let search = |request_id: u64| {
        ComputationTask::DataSearch(DataSearchTask {
            table_id: 1,
            table_version,
            input_data_frame: data_frame,
            row_number_column_name: "_rownum".into(),
            columns: vec![DataSearchColumn { column_idx: 0, column_group_idx: 2, field_name: "name".into() }],
            pattern: "a".into(),
            request_id,
        })
    };
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    setup.database.borrow_mut().gates.insert("Data search", gate);
    setup
        .service
        .apply(ComputationAction::SetResultSearchPattern {
            table_id: 1,
            kind: dashql_core_runtime::compute::SearchKind::Data,
            pattern: "a".into(),
        })
        .unwrap();
    let first = setup.schedule(search(1));
    let first_output = setup.run(setup.service.run_task(first));
    assert!(first_output.borrow().is_none());
    assert!(setup.service.is_running(first));

    // The next search aborts the first one, its run is cancelled and fails
    setup
        .service
        .apply(ComputationAction::SetResultSearchPattern {
            table_id: 1,
            kind: dashql_core_runtime::compute::SearchKind::Data,
            pattern: "b".into(),
        })
        .unwrap();
    setup.executor.run_until_stalled();
    assert!(!setup.service.is_running(first));
    assert_eq!(setup.database.borrow().cancelled.len(), 1);
    let error = first_output.borrow_mut().take().expect("the first search ended").unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");
    drop(release);

    let second = setup.schedule(search(2));
    let output = setup.run(setup.service.run_task(second));
    let Some(Ok(TaskOutput::DataSearch(table))) = output.borrow_mut().take() else { panic!("a data search") };
    assert_eq!(table.request_id, 2);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert_eq!(computation.data_search.matching_rows, Some(1));
    });
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn a_run_that_is_cancelled_by_its_id_drops_its_future() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let (table_version, data_frame) = setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        (computation.version, computation.data_frame.unwrap())
    });
    let search = ComputationTask::DataSearch(DataSearchTask {
        table_id: 1,
        table_version,
        input_data_frame: data_frame,
        row_number_column_name: "_rownum".into(),
        columns: vec![DataSearchColumn { column_idx: 0, column_group_idx: 2, field_name: "name".into() }],
        pattern: "a".into(),
        request_id: 1,
    });
    let (_release, gate): (Sender<()>, Receiver<()>) = oneshot();
    setup.database.borrow_mut().gates.insert("Data search", gate);
    setup
        .service
        .apply(ComputationAction::SetResultSearchPattern {
            table_id: 1,
            kind: dashql_core_runtime::compute::SearchKind::Data,
            pattern: "a".into(),
        })
        .unwrap();
    let task = setup.schedule(search);
    let output = setup.run(setup.service.run_task(task));
    assert!(output.borrow().is_none());
    let run = *setup.database.borrow().runs.last().unwrap();
    // A stopped query of the run cancels the run in Rust, not only the calls of the host
    assert!(setup.service.cancel_run(run));
    assert!(!setup.service.cancel_run(run));
    setup.executor.run_until_stalled();
    assert!(!setup.service.is_running(task));
    assert_eq!(setup.database.borrow().cancelled, [run]);
    let error = output.borrow_mut().take().expect("the task ended").unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");
    // The task ends cancelled, not failed
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        let search = computation.tasks.data_search.as_ref().expect("the task");
        assert_eq!(search.progress.status, TaskStatus::Cancelled);
        assert!(search.progress.failed_at.is_some());
        assert_eq!(state.scheduler_tasks().count(), 0);
    });
}

#[test]
fn a_task_whose_call_the_host_cancelled_ends_cancelled() {
    let setup = setup(analysis_answer);
    setup.database.borrow_mut().cancels.insert("Column aggregation");
    let error = setup.analyze().unwrap_err();
    assert!(error.to_string().contains("cancelled"), "{error}");
    setup.executor.run_until_stalled();
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        let cancelled = computation.tasks.column_aggregation.get(1).and_then(Option::as_ref).expect("the task");
        assert_eq!(cancelled.progress.status, TaskStatus::Cancelled);
        assert_eq!(state.scheduler_tasks().count(), 0);
    });
    // Its data frame goes like the one of a failed task
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn deleting_a_computation_cancels_its_runs_and_drops_its_data_frames() {
    let setup = setup(analysis_answer);
    let (_release, gate): (Sender<()>, Receiver<()>) = oneshot();
    setup.database.borrow_mut().gates.insert("System column computation", gate);
    let handles = setup.analysis_handles();
    let analysis = setup.run(setup.service.analyze_table(
        1,
        shape(&result()),
        handles,
        None,
        None,
        AnalyzeTableOptions::default(),
    ));
    assert!(analysis.borrow().is_none());

    setup.apply(ComputationAction::DeleteComputation { table_id: 1 });
    setup.executor.run_until_stalled();
    assert!(analysis.borrow().as_ref().is_some_and(|result| result.is_err()));
    assert_eq!(setup.database.borrow().cancelled.len(), 1);
    assert!(setup.service.read(|state| state.computation(1).is_none() && state.data_frames().is_empty()));
    assert!(setup.data_frame_tables().is_empty());
}

// The requests of the app

fn score_ascending() -> Vec<OrderByConstraint> {
    vec![OrderByConstraint { field: "score".into(), ascending: Some(true), nulls_first: Some(false) }]
}

/// The tasks of a computation that ran, by title
fn created(setup: &Setup, title: &str) -> usize {
    let suffix = format!("({title})");
    setup.database.borrow().calls.iter().filter(|call| call.starts_with("create") && call.ends_with(&suffix)).count()
}

#[test]
fn a_selection_filters_the_rows_and_orders_them_again() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();

    // An ordering runs once, asking again for the same ordering runs nothing
    setup.service.order_by(1, score_ascending()).unwrap();
    setup.executor.run_until_stalled();
    setup.service.order_by(1, score_ascending()).unwrap();
    setup.executor.run_until_stalled();
    assert_eq!(created(&setup, "Table ordering"), 1);
    assert!(setup.service.read(|state| state.computation(1).unwrap().ordering_table.is_some()));

    // A range of the histogram of the score filters the rows, the ordering follows the filter
    setup.service.histogram_filter(1, 1, Some((0.0, 1.0))).unwrap();
    setup.service.histogram_filter(1, 1, Some((0.0, 1.0))).unwrap();
    setup.executor.run_until_stalled();
    assert_eq!(created(&setup, "Table filtering"), 1);
    assert_eq!(created(&setup, "Table ordering"), 2);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        let filter = computation.filter_table.as_ref().expect("a filter");
        assert_eq!(filter.table.rows(), 2);
        let ordering = computation.ordering_table.as_ref().expect("an ordering");
        assert!(ordering.version.filter_matches(filter.version));
        assert!(computation.filtered_column_aggregate_outdated(1));
    });

    // The summary of the score over the selected rows, once
    setup.service.request_filtered_column_aggregation(1, 1).unwrap();
    setup.service.request_filtered_column_aggregation(1, 1).unwrap();
    setup.executor.run_until_stalled();
    assert_eq!(created(&setup, "Filtered column aggregation"), 1);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert!(computation.filtered_column_aggregate(1).is_some());
        assert!(!computation.filtered_column_aggregate_outdated(1));
    });

    // Clearing the selection drops the filter and orders all rows again
    setup.service.clear_cross_filters(1).unwrap();
    setup.executor.run_until_stalled();
    assert_eq!(created(&setup, "Table ordering"), 3);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert!(computation.filter_table.is_none());
        assert!(computation.ordering_table.is_some());
    });

    // A frequent value of the name selects, selecting it again clears it
    setup.service.most_frequent_value_filter(1, 2, Some(1)).unwrap();
    assert_eq!(setup.service.read(|state| state.computation(1).unwrap().cross_filters.column_filters.len()), 1);
    setup.service.most_frequent_value_filter(1, 2, Some(1)).unwrap();
    assert!(setup.service.read(|state| state.computation(1).unwrap().cross_filters.column_filters.is_empty()));

    // An empty ordering clears it
    setup.service.order_by(1, Vec::new()).unwrap();
    setup.executor.run_until_stalled();
    assert!(setup.service.read(|state| state.computation(1).unwrap().ordering_table.is_none()));
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn searches_run_once_the_data_frame_is_there() {
    let setup = setup(analysis_answer);
    let (release, gate): (Sender<()>, Receiver<()>) = oneshot();
    setup.database.borrow_mut().gates.insert("System column computation", gate);
    let handles = setup.analysis_handles();
    let analysis = setup.run(setup.service.analyze_table(
        1,
        shape(&result()),
        handles,
        None,
        None,
        AnalyzeTableOptions::default(),
    ));

    // The searches wait for the data frame with the system columns
    setup.service.set_search_pattern(1, SearchKind::Data, "a".into()).unwrap();
    setup.service.set_search_pattern(1, SearchKind::Columns, "nam".into()).unwrap();
    setup.executor.run_until_stalled();
    assert_eq!(created(&setup, "Data search"), 0);
    release.send(());
    setup.executor.run_until_stalled();
    assert!(analysis.borrow().as_ref().is_some_and(|result| result.is_ok()));
    assert_eq!(created(&setup, "Data search"), 1);
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert_eq!(computation.data_search.matching_rows, Some(1));
        assert!(!computation.data_search.pending);
        assert_eq!(computation.column_search.matching_column_groups, Some(vec![2]));
        assert!(computation.filtered_column_aggregate_outdated(1));
    });

    // With a filter and a data search the summary over the selected rows counts their intersection
    setup.service.histogram_filter(1, 1, Some((0.0, 1.0))).unwrap();
    setup.executor.run_until_stalled();
    setup.service.request_filtered_column_aggregation(1, 1).unwrap();
    setup.executor.run_until_stalled();
    assert!(setup.database.borrow().queries.iter().any(|sql| sql.starts_with("SELECT count(*)")));
    assert_eq!(created(&setup, "Filtered column aggregation"), 1);

    // Ending the searches
    setup.service.set_search_pattern(1, SearchKind::Data, String::new()).unwrap();
    setup.service.set_search_pattern(1, SearchKind::Columns, String::new()).unwrap();
    setup.executor.run_until_stalled();
    setup.service.read(|state| {
        let computation = state.computation(1).unwrap();
        assert!(computation.data_search_table.is_none());
        assert!(computation.column_search.matching_column_groups.is_none());
    });
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn an_ordering_to_wait_for_skips_unknown_fields() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let unknown = vec![OrderByConstraint { field: "gone".into(), ascending: None, nulls_first: None }];
    let output = setup.run(setup.service.order_by_and_wait(1, unknown));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(()))));
    assert_eq!(created(&setup, "Table ordering"), 0);
    let output = setup.run(setup.service.order_by_and_wait(1, score_ascending()));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(()))));
    assert!(setup.service.read(|state| state.computation(1).unwrap().ordering_table.is_some()));
}

#[test]
fn requests_of_an_unknown_computation_change_nothing() {
    let setup = setup(analysis_answer);
    assert!(!setup.service.order_by(7, score_ascending()).unwrap().changed);
    assert!(!setup.service.histogram_filter(7, 1, Some((0.0, 1.0))).unwrap().changed);
    assert!(!setup.service.most_frequent_value_filter(7, 2, Some(1)).unwrap().changed);
    assert!(!setup.service.set_search_pattern(7, SearchKind::Data, "a".into()).unwrap().changed);
    setup.service.request_filtered_column_aggregation(7, 1).unwrap();
    assert!(!setup.service.delete_computation(7).unwrap().changed);
    setup.executor.run_until_stalled();
    assert!(setup.database.borrow().calls.is_empty());
}

#[test]
fn previews_the_first_rows_of_a_result_from_its_data_frame() {
    let setup = setup(analysis_answer);
    setup.analyze().unwrap();
    let data_frame =
        setup.service.read(|state| state.computation(1).and_then(|computation| computation.data_frame)).unwrap();
    let output = setup.run(setup.service.preview(1, 2));
    let ipc = output.borrow_mut().take().expect("the preview finished").unwrap();
    assert!(ResultTable::from_ipc_stream(&ipc).is_ok());
    // The fields of the result in the order of its rows, without the system columns
    let queries = setup.database.borrow().queries.clone();
    let preview = queries.last().expect("a preview query");
    assert!(preview.starts_with(&format!(r#"SELECT "score", "name" FROM "__df_{data_frame}""#)), "{preview}");
    assert!(preview.contains(r#"ORDER BY "_rownum""#), "{preview}");
    assert!(preview.ends_with("LIMIT 2"), "{preview}");
}

#[test]
fn a_preview_needs_an_analyzed_result() {
    let setup = setup(analysis_answer);
    let output = setup.run(setup.service.preview(7, 10));
    let error = output.borrow_mut().take().expect("the preview finished").unwrap_err();
    assert!(error.to_string().contains("the table 7 has no computation"), "{error}");
    assert!(setup.database.borrow().queries.is_empty());
}
