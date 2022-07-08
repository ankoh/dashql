use super::{
    execution_context::{ExecutionContext, ExecutionContextSnapshot, ExecutionState},
    task::{
        duckdb_create_as_task::DuckDBCreateAsTask,
        duckdb_create_table_task::DuckDBCreateTableTask,
        duckdb_create_view_task::DuckDBCreateViewTask,
        Task,
        {duckdb_load_task::DuckDBLoadTask, import_task::ImportTask, vega_visualize_task::VegaVisualizeTask},
    },
    task_scheduler_log::TaskSchedulerLog,
};
use crate::{
    analyzer::{
        program_instance::ProgramInstance,
        task_planner::{ProgramTask, ProgramTaskType, SetupTask, SetupTaskType, TaskClass, TaskGraph, TaskStatusCode},
    },
    error::SystemError,
    utils::topological_sort::TopologicalSort,
};
use futures::StreamExt;

pub struct TaskScheduler<'ast> {
    /// The program
    instance: &'ast ProgramInstance<'ast>,
    /// The task class
    task_class: TaskClass,
    /// The derived task logic
    task_logic: Vec<Option<Box<dyn Task<'ast> + 'ast>>>,
    /// The task alive
    task_alive: Vec<bool>,
    /// The task topology
    task_topology: TopologicalSort<usize>,
    /// The dependencies
    task_required_for: Vec<&'ast [usize]>,
}

fn translate_setup_task<'ast>(task: &SetupTask) -> Result<Option<Box<dyn Task<'ast>>>, SystemError> {
    let logic = match task.task_type {
        SetupTaskType::None => None,
        SetupTaskType::DropBlob => todo!(),
        SetupTaskType::DropInput => todo!(),
        SetupTaskType::DropTable => todo!(),
        SetupTaskType::DropView => todo!(),
        SetupTaskType::DropViz => todo!(),
        SetupTaskType::Unset => todo!(),
    };
    Ok(logic)
}

fn translate_program_task<'ast>(
    instance: &'ast ProgramInstance<'ast>,
    task: &'ast ProgramTask,
) -> Result<Option<Box<dyn Task<'ast> + 'ast>>, SystemError> {
    let logic: Box<dyn Task<'ast>> = match task.task_type {
        ProgramTaskType::None => return Ok(None),
        ProgramTaskType::CreateAs => Box::new(DuckDBCreateAsTask::create(instance, task)?),
        ProgramTaskType::CreateTable => Box::new(DuckDBCreateTableTask::create(instance, task)?),
        ProgramTaskType::CreateView => Box::new(DuckDBCreateViewTask::create(instance, task)?),
        ProgramTaskType::CreateViz => Box::new(VegaVisualizeTask::create(instance, task)?),
        ProgramTaskType::Import => Box::new(ImportTask::create(instance, task)?),
        ProgramTaskType::Declare => todo!(),
        ProgramTaskType::Load => Box::new(DuckDBLoadTask::create(instance, task)?),
        ProgramTaskType::ModifyTable => todo!(),
        ProgramTaskType::Set => todo!(),
        ProgramTaskType::UpdateViz => todo!(),
    };
    Ok(Some(logic))
}

impl<'ast> TaskScheduler<'ast> {
    /// Create setup scheduler
    pub fn schedule_setup(
        program: &'ast ProgramInstance<'ast>,
        task_graph: &'ast TaskGraph,
    ) -> Result<Self, SystemError> {
        let n = task_graph.setup_tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        let mut alive = Vec::with_capacity(n);
        let mut required_for = Vec::with_capacity(n);
        for (setup_id, setup_task) in task_graph.setup_tasks.iter().enumerate() {
            topo.push((setup_id, setup_task.depends_on.len()));
            alive.push(setup_task.task_status.get() == TaskStatusCode::Pending);
            logic.push(translate_setup_task(setup_task)?);
            required_for.push(setup_task.required_for.as_slice());
        }
        Ok(Self {
            instance: program,
            task_class: TaskClass::SetupTask,
            task_logic: logic,
            task_topology: TopologicalSort::new(topo),
            task_alive: alive,
            task_required_for: required_for,
        })
    }

    /// Create program scheduler
    pub fn schedule_program(
        instance: &'ast ProgramInstance<'ast>,
        task_graph: &'ast TaskGraph,
    ) -> Result<Self, SystemError> {
        let n = task_graph.setup_tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        let mut alive = Vec::with_capacity(n);
        let mut required_for = Vec::with_capacity(n);
        for (program_id, program_task) in task_graph.program_tasks.iter().enumerate() {
            topo.push((program_id, program_task.depends_on.len()));
            logic.push(translate_program_task(instance, program_task)?);
            alive.push(program_task.task_status.get() == TaskStatusCode::Pending);
            required_for.push(program_task.required_for.as_slice());
        }
        Ok(Self {
            instance,
            task_class: TaskClass::ProgramTask,
            task_logic: logic,
            task_alive: alive,
            task_topology: TopologicalSort::new(topo),
            task_required_for: required_for,
        })
    }

    /// Prepare a task
    async fn prepare_task<'snap, 'task>(
        task_id: usize,
        task: &'task mut Box<dyn Task<'ast> + 'ast>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.prepare(&mut snapshot).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    /// Execute a task
    async fn execute_task<'snap, 'task>(
        task_id: usize,
        task: &'task mut Box<dyn Task<'ast> + 'ast>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.execute(&mut snapshot).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    pub async fn next(&mut self, log: &mut TaskSchedulerLog) -> Result<bool, SystemError> {
        // Collect all tasks that can be scheduled
        let mut task_ids = Vec::with_capacity(self.task_logic.len());
        let mut tasks = Vec::with_capacity(self.task_logic.len());
        while !self.task_topology.is_empty() {
            let (task_id, waiting_for) = self.task_topology.top();
            if *waiting_for > 0 {
                break;
            }
            if self.task_alive[*task_id] {
                task_ids.push(*task_id);
                tasks.push(std::mem::replace(&mut self.task_logic[*task_id], None).unwrap());
            }
            self.task_topology.pop();
        }
        if task_ids.is_empty() {
            return Ok(false);
        }

        // Merge execution context data
        let merge_into =
            |local: Vec<ExecutionState<'ast>>, global: &ExecutionContext<'ast>| -> Result<(), SystemError> {
                let mut global = global.try_write_global()?;
                for data in local {
                    data.merge_into(&mut global);
                }
                Ok(())
            };

        // Prepare all tasks
        for task_id in task_ids.iter() {
            log.task_updated(self.task_class, *task_id, TaskStatusCode::Preparing);
        }
        log.flush().await;
        let mut task_futures: futures::stream::FuturesUnordered<_> = tasks
            .iter_mut()
            .enumerate()
            .filter(|(task_id, _task)| self.task_alive[*task_id])
            .map(|(task_id, task)| (task_id, task, self.instance.context.snapshot()))
            .map(|(task_id, task, snap)| TaskScheduler::prepare_task(task_id, task, snap))
            .collect();
        let mut snapshots = Vec::with_capacity(task_futures.len());
        loop {
            let (task_id, res) = match task_futures.next().await {
                Some(res) => res,
                None => break,
            };
            match res {
                Ok(snap) => {
                    snapshots.push(snap.finish());
                    log.task_updated(self.task_class, task_id, TaskStatusCode::Prepared);
                }
                Err(e) => {
                    self.task_alive[task_id] = false;
                    log.task_failed(self.task_class, task_id, e);
                }
            };
            log.flush().await;
        }
        drop(task_futures);
        merge_into(snapshots, &self.instance.context)?;

        // XXX Opportunity to run shared computations after preparing every task

        // Execute all tasks
        for task_id in task_ids.iter() {
            if self.task_alive[*task_id] {
                log.task_updated(self.task_class, *task_id, TaskStatusCode::Executing);
            }
        }
        log.flush().await;
        let mut task_futures: futures::stream::FuturesUnordered<_> = tasks
            .iter_mut()
            .enumerate()
            .filter(|(task_id, _task)| self.task_alive[*task_id])
            .map(|(task_id, task)| (task_id, task, self.instance.context.snapshot()))
            .map(|(task_id, task, snap)| TaskScheduler::execute_task(task_id, task, snap))
            .collect();
        let mut snapshots = Vec::with_capacity(task_futures.len());
        loop {
            let (task_id, res) = match task_futures.next().await {
                Some(res) => res,
                None => break,
            };
            match res {
                Ok(snap) => {
                    snapshots.push(snap.finish());
                    log.task_updated(self.task_class, task_id, TaskStatusCode::Completed);
                }
                Err(e) => {
                    self.task_alive[task_id] = false;
                    log.task_failed(self.task_class, task_id, e);
                }
            };
            log.flush().await;
        }
        merge_into(snapshots, &self.instance.context)?;

        // Update topology
        for task_id in task_ids.iter() {
            if self.task_alive[*task_id] {
                for req_for in self.task_required_for[*task_id] {
                    self.task_topology.decrement_key(req_for);
                }
            }
        }

        let work_left = !self.task_topology.is_empty();
        Ok(work_left)
    }
}

#[derive(PartialEq, Eq)]
enum TaskGraphSchedulerPhase {
    SetupTasks,
    ProgramTasks,
}

pub struct TaskGraphScheduler<'ast> {
    /// The program
    _program: &'ast ProgramInstance<'ast>,
    /// The task graph
    _task_graph: &'ast TaskGraph,
    /// The setup tasks
    setup_scheduler: TaskScheduler<'ast>,
    /// The program tasks
    program_scheduler: TaskScheduler<'ast>,
    /// The scheduler phase
    current_phase: TaskGraphSchedulerPhase,
}

impl<'ast> TaskGraphScheduler<'ast> {
    pub fn schedule(program: &'ast ProgramInstance<'ast>, graph: &'ast TaskGraph) -> Result<Self, SystemError> {
        let setup_sched = TaskScheduler::schedule_setup(program, graph)?;
        let program_sched = TaskScheduler::schedule_program(program, graph)?;
        Ok(Self {
            _program: program,
            _task_graph: graph,
            setup_scheduler: setup_sched,
            program_scheduler: program_sched,
            current_phase: TaskGraphSchedulerPhase::SetupTasks,
        })
    }

    pub async fn next(&mut self, log: &mut TaskSchedulerLog) -> Result<bool, SystemError> {
        let scheduler = match self.current_phase {
            TaskGraphSchedulerPhase::ProgramTasks => &mut self.program_scheduler,
            TaskGraphSchedulerPhase::SetupTasks => &mut self.setup_scheduler,
        };
        let mut work_left = scheduler.next(log).await?;
        if !work_left && self.current_phase == TaskGraphSchedulerPhase::SetupTasks {
            work_left = true;
            self.current_phase = TaskGraphSchedulerPhase::ProgramTasks;
        }
        Ok(work_left)
    }
}

#[cfg(test)]
mod test {
    use crate::{
        analyzer::{program_instance::analyze_program, task_planner::plan_tasks},
        external::parser::parse_into,
        grammar,
    };
    use arrow::record_batch::RecordBatch;
    use arrow::{
        array::Int64Array,
        datatypes::{DataType, Field, Schema},
    };
    use pretty_assertions::assert_eq;
    use std::{collections::HashMap, error::Error, rc::Rc, sync::Arc};

    pub use super::*;

    struct QueryTest {
        pub query: &'static str,
        pub expected: arrow::record_batch::RecordBatch,
    }

    async fn test_simple_script(
        script: &'static str,
        tests: Vec<QueryTest>,
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        // Plan the program
        let arena = bumpalo::Bump::new();
        let context = ExecutionContext::create_simple(&arena).await?;
        let (program_ast, program_data) = parse_into(&arena, script)?;
        let program = Rc::new(grammar::deserialize_ast(&arena, script, program_ast, program_data).unwrap());
        let instance = analyze_program(context, script, program_ast, program, HashMap::new())?;
        let task_graph = plan_tasks(&instance, None)?;

        // Run the scheduler
        let mut task_scheduler = TaskGraphScheduler::schedule(&instance, &task_graph)?;
        let mut scheduler_log = TaskSchedulerLog::create();
        loop {
            let work_left = task_scheduler.next(&mut scheduler_log).await?;
            if !work_left {
                break;
            }
        }
        assert!(!scheduler_log.any_failed, "{:?}", scheduler_log.entries);

        // Test all queries
        let connection = instance.context.database.connect().await?;
        for (_test_id, test) in tests.iter().enumerate() {
            let result = connection.run_query(test.query).await?;
            assert_eq!(result.len(), 1);
            assert_eq!(test.expected, result[0]);
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_load_0() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_simple_script(
            r#"
import lineitem_data from 'test://tpch/0_01/parquet/lineitem.parquet';
load lineitem from lineitem_data using parquet;
vis lineitem using table;
            "#,
            vec![QueryTest {
                query: "select count(*) as a from lineitem",
                expected: RecordBatch::try_new(
                    Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, true)])),
                    vec![Arc::new(Int64Array::from(vec![60175]))],
                )?,
            }],
        )
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn test_load_1() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_simple_script(
            r#"
import nation_data from 'test://tpch/0_01/parquet/nation.parquet';
import region_data from 'test://tpch/0_01/parquet/region.parquet';
load nation from nation_data using parquet;
load region from region_data using parquet;
create table joined as
    select * from nation, region where n_nationkey = r_nationkey;
vis joined using table;
            "#,
            vec![QueryTest {
                query: "select count(*) as a from joined",
                expected: RecordBatch::try_new(
                    Arc::new(Schema::new(vec![Field::new("a", DataType::Int64, true)])),
                    vec![Arc::new(Int64Array::from(vec![125]))],
                )?,
            }],
        )
        .await?;
        Ok(())
    }
}
