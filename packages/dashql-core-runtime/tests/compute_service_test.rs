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
use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, RunId};
use dashql_core_runtime::compute::service::{ComputeService, TaskOutput};
use dashql_core_runtime::compute::tasks::analyze_table::AnalyzeTableOptions;
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::types::{
    ColumnAggregate, ColumnGroup, ColumnSummaryAnalysis, ComputationTask, DataSearchColumn, DataSearchTask, FilterOp,
    ScalarFilter, TableFilteringTask, TaskStatus,
};
use dashql_core_runtime::compute::{ComputationAction, ComputationEffect};
use dashql_core_runtime::host::signal::{oneshot, Receiver, Sender};
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};

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
    /// The runs that the service cancelled
    cancelled: Vec<RunId>,
    /// The effects of the changes that the tasks reported
    changes: Vec<Vec<ComputationEffect>>,
    /// Holds the next creation of a table of a title until the test releases it
    gates: BTreeMap<&'static str, Receiver<()>>,
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
}

/// The table that a read names
fn read_table(sql: &str) -> Option<String> {
    let start = sql.find("\"__df_")? + 1;
    let end = start + sql.get(start..)?.find('"')?;
    sql.get(start..end).map(str::to_string)
}

impl ComputeHost for FakeHost {
    async fn import_table(&self, _data_frame: u64, table_name: &str, ipc: Vec<u8>, _context: &ComputeContext) -> std::result::Result<(), HostError> {
        let table = ResultTable::from_ipc_stream(&ipc).map_err(|e| HostError::new(e.to_string()))?;
        let mut database = self.database.borrow_mut();
        database.calls.push(format!("import {table_name}"));
        database.tables.insert(table_name.to_string(), table);
        Ok(())
    }

    async fn create_table(&self, _data_frame: u64, table_name: &str, sql: &str, context: &ComputeContext) -> std::result::Result<(), HostError> {
        self.database.borrow_mut().calls.push(format!("create {table_name} ({})", context.title));
        let gate = self.database.borrow_mut().gates.remove(context.title);
        if let Some(gate) = gate {
            gate.await;
        }
        let table = (self.answer)(context.title, sql).map_err(HostError::new)?;
        self.database.borrow_mut().tables.insert(table_name.to_string(), table);
        Ok(())
    }

    async fn query(&self, sql: &str, _context: &ComputeContext) -> std::result::Result<Vec<u8>, HostError> {
        let name = read_table(sql).ok_or_else(|| HostError::new(format!("no table in {sql}")))?;
        let database = self.database.borrow();
        let table = database.tables.get(&name).ok_or_else(|| HostError::new(format!("no table {name}")))?;
        table.to_ipc_stream().map_err(|e| HostError::new(e.to_string()))
    }

    async fn drop_table(&self, _data_frame: u64, table_name: &str) -> std::result::Result<(), HostError> {
        let mut database = self.database.borrow_mut();
        database.calls.push(format!("drop {table_name}"));
        database.tables.remove(table_name);
        Ok(())
    }

    fn cancel(&self, run: RunId) {
        self.database.borrow_mut().cancelled.push(run);
    }

    fn changed(&self, effects: &[ComputationEffect]) {
        self.database.borrow_mut().changes.push(effects.to_vec());
    }
}

// Tables

fn a<T: arrow_array::Array + 'static>(array: T) -> ArrayRef {
    Arc::new(array)
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
    let host = FakeHost { executor: executor.clone(), clock: Cell::new(1000.0), database: database.clone(), answer: Box::new(answer) };
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

    fn analyze(&self) -> Result<()> {
        let analysis = self.service.analyze_table(1, result(), Some("connection".into()), None, AnalyzeTableOptions::default());
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

    /// The id of the first data frame, the import of the result
    fn first_id(&self) -> u64 {
        let calls = self.database.borrow().calls.clone();
        calls.first().and_then(|call| call.strip_prefix("import __df_")).and_then(|id| id.parse().ok()).expect("an import")
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
    // The ids of a thread count up, the analysis takes them in order
    let base = setup.first_id();
    assert_eq!(
        calls,
        vec![
            format!("import __df_{base}"),
            format!("create __df_{} (Table aggregation)", base + 4),
            format!("create __df_{} (System column computation)", base + 7),
            format!("create __df_{} (Column aggregation)", base + 10),
            format!("create __df_{} (Column aggregation)", base + 13),
        ]
    );
    setup.service.read(|state| {
        let computation = state.computation(1).expect("a computation");
        assert_eq!(computation.connection_id.as_deref(), Some("connection"));
        assert_eq!(computation.data_frame, Some(base + 7));
        assert_eq!(computation.version.data, 2);
        assert_eq!(computation.row_number_column_name.as_deref(), Some("_rownum"));
        assert_eq!(computation.data_table.rows(), 4);
        let aggregation = computation.table_aggregation.as_ref().expect("the statistics");
        assert_eq!((aggregation.data_frame, aggregation.table.rows()), (base + 4, 1));
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
        assert!(computation.tasks.column_aggregation.iter().flatten().all(|t| t.progress.status == TaskStatus::Succeeded));
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
    let output = setup.run(setup.service.analyze_table(1, empty, None, None, AnalyzeTableOptions::default()));
    assert!(matches!(output.borrow().as_ref(), Some(Ok(()))));
    assert!(setup.service.read(|state| state.computation(1).is_none()));
    assert!(setup.database.borrow().calls.is_empty());
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
    let failed = format!("drop __df_{}", setup.first_id() + 10);
    assert!(setup.database.borrow().calls.contains(&failed));
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
    setup.service.apply(ComputationAction::SetResultSearchPattern { table_id: 1, kind: dashql_core_runtime::compute::SearchKind::Data, pattern: "a".into() }).unwrap();
    let first = setup.schedule(search(1));
    let first_output = setup.run(setup.service.run_task(first));
    assert!(first_output.borrow().is_none());
    assert!(setup.service.is_running(first));

    // The next search aborts the first one, its run is cancelled and fails
    setup.service.apply(ComputationAction::SetResultSearchPattern { table_id: 1, kind: dashql_core_runtime::compute::SearchKind::Data, pattern: "b".into() }).unwrap();
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
        assert_eq!(computation.data_search.matching_rows.as_ref().map(|rows| rows.len()), Some(1));
    });
    setup.executor.run_until_stalled();
    assert_eq!(setup.data_frame_tables(), setup.state_data_frame_tables());
}

#[test]
fn deleting_a_computation_cancels_its_runs_and_drops_its_data_frames() {
    let setup = setup(analysis_answer);
    let (_release, gate): (Sender<()>, Receiver<()>) = oneshot();
    setup.database.borrow_mut().gates.insert("System column computation", gate);
    let analysis = setup.run(setup.service.analyze_table(1, result(), None, None, AnalyzeTableOptions::default()));
    assert!(analysis.borrow().is_none());

    setup.service.apply(ComputationAction::DeleteComputation { table_id: 1 }).unwrap();
    setup.executor.run_until_stalled();
    assert!(analysis.borrow().as_ref().is_some_and(|result| result.is_err()));
    assert_eq!(setup.database.borrow().cancelled.len(), 1);
    assert!(setup.service.read(|state| state.computation(1).is_none() && state.data_frames().is_empty()));
    assert!(setup.data_frame_tables().is_empty());
}
