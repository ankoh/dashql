use std::sync::Arc;

use super::{
    execution_context::{ExecutionContext, ExecutionContextSnapshot, ExecutionState},
    task::{
        declare_task::DeclareTaskOperator,
        drop_input_task::DropInputTaskOperator,
        duckdb_create_table_task::DuckDBCreateTableTaskOperator,
        duckdb_drop_import_task::DuckDBDropImportTaskOperator,
        duckdb_drop_table_task::DuckDBDropTableTaskOperator,
        duckdb_update_table_task::DuckDBUpdateTableTaskOperator,
        set_task::SetTaskOperator,
        unset_task::UnsetTaskOperator,
        vega_drop_vis_task::VegaDropVisTaskOperator,
        TaskOperator,
        {duckdb_load_task::DuckDBLoadTaskOperator, import_task::ImportTask, vega_vis_task::VegaVisTaskOperator},
    },
    task_scheduler_log::TaskSchedulerLog,
};
use crate::{
    analyzer::{
        program_instance::ProgramInstance,
        task::{TaskStatusCode, TaskType},
        task_graph::TaskGraph,
    },
    error::SystemError,
    external::console,
    utils::topological_sort::TopologicalSort,
};
use futures::StreamExt;

pub struct TaskScheduler<'ast> {
    /// The program
    instance: Arc<ProgramInstance<'ast>>,
    /// The graph
    task_graph: Arc<TaskGraph>,
    /// The derived task logic
    task_logic: Vec<Option<Box<dyn TaskOperator<'ast> + 'ast>>>,
    /// The task alive
    task_alive: Vec<bool>,
    /// The task topology
    task_topology: TopologicalSort<usize>,
    /// The dependencies
    task_required_for: Vec<Vec<usize>>,
}

unsafe impl<'ast> Sync for TaskScheduler<'ast> {}

fn create_task_operator<'ast>(
    instance: &Arc<ProgramInstance<'ast>>,
    task_graph: &Arc<TaskGraph>,
    task_id: usize,
) -> Result<Option<Box<dyn TaskOperator<'ast> + 'ast>>, SystemError> {
    let task = &task_graph.tasks[task_id];
    let op: Box<dyn TaskOperator<'ast> + 'ast> = match task.task_type {
        TaskType::None => return Ok(None),
        TaskType::DropImport => Box::new(DuckDBDropImportTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropInput => Box::new(DropInputTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropTable => Box::new(DuckDBDropTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropViz => Box::new(VegaDropVisTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Unset => Box::new(UnsetTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::CreateTable => Box::new(DuckDBCreateTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::CreateViz => Box::new(VegaVisTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Import => Box::new(ImportTask::create(instance, task_graph, task_id)?),
        TaskType::Declare => Box::new(DeclareTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Load => Box::new(DuckDBLoadTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::UpdateTable => Box::new(DuckDBUpdateTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Set => Box::new(SetTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::UpdateViz => Box::new(VegaVisTaskOperator::create(instance, task_graph, task_id)?),
    };
    Ok(Some(op))
}

impl<'ast> TaskScheduler<'ast> {
    pub fn schedule(instance: Arc<ProgramInstance<'ast>>, task_graph: Arc<TaskGraph>) -> Result<Self, SystemError> {
        let n = task_graph.tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        let mut alive = Vec::with_capacity(n);
        let mut required_for = Vec::with_capacity(n);
        for (task_id, task) in task_graph.tasks.iter().enumerate() {
            topo.push((task_id, task.depends_on.len()));
            logic.push(create_task_operator(&instance, &task_graph, task_id)?);
            alive.push(task.task_status.load(std::sync::atomic::Ordering::SeqCst) == TaskStatusCode::Pending as u8);
            required_for.push(task.required_for.clone());
        }
        Ok(Self {
            instance,
            task_graph,
            task_logic: logic,
            task_alive: alive,
            task_topology: TopologicalSort::new(topo),
            task_required_for: required_for,
        })
    }

    /// Prepare a task
    async fn prepare_task<'snap, 'task: 'snap>(
        task_id: usize,
        task: &'task mut Box<dyn TaskOperator<'ast> + 'ast>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.prepare(&mut snapshot).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    /// Execute a task
    async fn execute_task<'snap, 'task: 'snap>(
        task_id: usize,
        task: &'task mut Box<dyn TaskOperator<'ast> + 'ast>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.execute(&mut snapshot).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    pub async fn next(&mut self, log: &mut dyn TaskSchedulerLog) -> Result<bool, SystemError> {
        // Collect all tasks that can be scheduled
        let mut task_ids = Vec::with_capacity(self.task_logic.len());
        let mut task_ops = Vec::with_capacity(self.task_logic.len());
        console::println(&format!("CHOOSE NEXT: {:?}", self.task_graph.tasks));
        console::println(&format!("TOPO: {:?}", self.task_topology));
        while !self.task_topology.is_empty() {
            let (task_id, waiting_for) = self.task_topology.top();
            if *waiting_for > 0 {
                break;
            }
            if self.task_alive[*task_id] {
                task_ids.push(*task_id);
                task_ops.push(std::mem::replace(&mut self.task_logic[*task_id], None).unwrap());
            }
            self.task_topology.pop();
        }
        if task_ids.is_empty() {
            return Ok(false);
        }
        console::println(&format!("NEXT WORK ON: {:?}", task_ids));

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
            self.task_graph.tasks[*task_id]
                .task_status
                .store(TaskStatusCode::Preparing as u8, std::sync::atomic::Ordering::SeqCst);
            log.task_updated(*task_id, TaskStatusCode::Preparing);
        }
        log.flush();
        let instance = self.instance.clone();
        let mut task_futures: futures::stream::FuturesUnordered<_> = task_ops
            .iter_mut()
            .enumerate()
            .map(|(task_op_id, task)| (task_ids[task_op_id], task))
            .filter(|(task_id, _task)| self.task_alive[*task_id])
            .map(|(task_id, task)| (task_id, task, instance.context.snapshot()))
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
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Prepared as u8, std::sync::atomic::Ordering::SeqCst);
                    log.task_updated(task_id, TaskStatusCode::Prepared);
                }
                Err(e) => {
                    self.task_alive[task_id] = false;
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Failed as u8, std::sync::atomic::Ordering::SeqCst);
                    log.task_failed(task_id, e);
                }
            };
            log.flush();
        }
        drop(task_futures);
        merge_into(snapshots, &self.instance.context)?;

        // XXX Opportunity to run shared computations after preparing every task

        // Execute all tasks
        for task_id in task_ids.iter() {
            if self.task_alive[*task_id] {
                self.task_graph.tasks[*task_id]
                    .task_status
                    .store(TaskStatusCode::Executing as u8, std::sync::atomic::Ordering::SeqCst);
                log.task_updated(*task_id, TaskStatusCode::Executing);
            }
        }
        log.flush();
        let mut task_futures: futures::stream::FuturesUnordered<_> = task_ops
            .iter_mut()
            .enumerate()
            .map(|(task_op_id, task)| (task_ids[task_op_id], task))
            .filter(|(task_id, _task)| self.task_alive[*task_id])
            .map(|(task_id, task)| (task_id, task, instance.context.snapshot()))
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
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Completed as u8, std::sync::atomic::Ordering::SeqCst);
                    log.task_updated(task_id, TaskStatusCode::Completed);
                }
                Err(e) => {
                    self.task_alive[task_id] = false;
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Failed as u8, std::sync::atomic::Ordering::SeqCst);
                    log.task_failed(task_id, e);
                }
            };
            log.flush();
        }
        merge_into(snapshots, &self.instance.context)?;

        // Update topology
        for task_id in task_ids.iter() {
            if self.task_alive[*task_id] {
                for req_for in self.task_required_for[*task_id].iter() {
                    self.task_topology.decrement_key(req_for);
                }
            }
        }

        let work_left = !self.task_topology.is_empty();
        Ok(work_left)
    }
}

#[cfg(test)]
mod test {
    use crate::{
        analyzer::{program_instance::analyze_program, task_planner::plan_tasks},
        execution::task_scheduler_log::SimpleTaskSchedulerLog,
        external::parser::parse_into,
        grammar,
    };
    use arrow::record_batch::RecordBatch;
    use arrow::{
        array::Int64Array,
        datatypes::{DataType, Field, Schema},
    };
    use pretty_assertions::assert_eq;
    use std::{collections::HashMap, error::Error, sync::Arc};

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
        let (program_ast, program_data) = parse_into(&arena, script).await?;
        let program = Arc::new(grammar::deserialize_ast(&arena, script, program_ast, program_data).unwrap());
        let instance = Arc::new(analyze_program(context, script, program, HashMap::new())?);
        let task_graph = Arc::new(plan_tasks(instance.clone(), None)?);

        // Run the scheduler
        let mut task_scheduler = TaskScheduler::schedule(instance.clone(), task_graph)?;
        let mut scheduler_log = SimpleTaskSchedulerLog::create();
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
            let result_batches = result.read_arrow_batches()?;
            assert_eq!(result_batches.len(), 1);
            assert_eq!(test.expected, result_batches[0]);
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
