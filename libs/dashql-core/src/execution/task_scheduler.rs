use std::sync::atomic::Ordering;

use super::{
    execution_context::{ExecutionContext, ExecutionContextSnapshot, ExecutionState},
    task::{
        db_create_table_task::DBCreateTableTaskOperator, db_drop_import_task::DBDropImportTaskOperator,
        db_drop_table_task::DBDropTableTaskOperator, db_load_task::DBLoadTaskOperator,
        db_update_table_task::DBUpdateTableTaskOperator, drop_input_task::DropInputTaskOperator,
        drop_vis_task::DropVisTaskOperator, import_task::ImportTask, input_task::InputTaskOperator,
        set_task::SetTaskOperator, unset_task::UnsetTaskOperator, viz_task::VegaVisTaskOperator, TaskOperator,
    },
};
use crate::{
    analyzer::{
        program_instance::ProgramInstance,
        task::{TaskStatusCode, TaskType},
        task_graph::TaskGraph,
    },
    api::workflow_frontend::WorkflowFrontend,
    error::SystemError,
    utils::topological_sort::TopologicalSort,
};
use futures::StreamExt;

pub struct TaskScheduler<'exec, 'ast> {
    /// The program
    instance: &'exec ProgramInstance<'ast>,
    /// The graph
    task_graph: &'exec TaskGraph,
    /// The derived task logic
    task_logic: Vec<Option<Box<dyn TaskOperator<'exec, 'ast> + 'exec>>>,
    /// The task topology
    task_topology: TopologicalSort<usize>,
    /// The dependencies
    task_required_for: Vec<Vec<usize>>,
}

fn create_task_operator<'exec, 'ast>(
    instance: &'exec ProgramInstance<'ast>,
    task_graph: &'exec TaskGraph,
    task_id: usize,
) -> Result<Option<Box<dyn TaskOperator<'exec, 'ast> + 'exec>>, SystemError> {
    let task = &task_graph.tasks[task_id];
    let op: Box<dyn TaskOperator<'exec, 'ast> + 'exec> = match task.task_type {
        TaskType::None => return Ok(None),
        TaskType::DropImport => Box::new(DBDropImportTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropInput => Box::new(DropInputTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropTable => Box::new(DBDropTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::DropViz => Box::new(DropVisTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Unset => Box::new(UnsetTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::CreateTable => Box::new(DBCreateTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::CreateViz => Box::new(VegaVisTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Import => Box::new(ImportTask::create(instance, task_graph, task_id)?),
        TaskType::Input => Box::new(InputTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Load => Box::new(DBLoadTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::UpdateTable => Box::new(DBUpdateTableTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::Set => Box::new(SetTaskOperator::create(instance, task_graph, task_id)?),
        TaskType::UpdateViz => Box::new(VegaVisTaskOperator::create(instance, task_graph, task_id)?),
    };
    Ok(Some(op))
}

impl<'exec, 'ast> TaskScheduler<'exec, 'ast> {
    pub fn schedule(instance: &'exec ProgramInstance<'ast>, task_graph: &'exec TaskGraph) -> Result<Self, SystemError> {
        let n = task_graph.tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        let mut required_for = Vec::with_capacity(n);
        for (task_id, task) in task_graph.tasks.iter().enumerate() {
            topo.push((task_id, task.depends_on.len()));
            logic.push(create_task_operator(&instance, &task_graph, task_id)?);
            required_for.push(task.required_for.clone());
        }
        Ok(Self {
            instance,
            task_graph,
            task_logic: logic,
            task_topology: TopologicalSort::new(topo),
            task_required_for: required_for,
        })
    }

    /// Prepare a task
    async fn prepare_task<'snap, 'task: 'snap>(
        task_id: usize,
        task: &'task mut Box<dyn TaskOperator<'exec, 'ast> + 'exec>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.prepare(&mut snapshot, frontend).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    /// Execute a task
    async fn execute_task<'snap, 'task: 'snap>(
        task_id: usize,
        task: &'task mut Box<dyn TaskOperator<'exec, 'ast> + 'exec>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> (usize, Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError>) {
        match task.execute(&mut snapshot, frontend).await {
            Ok(()) => (task_id, Ok(snapshot)),
            Err(e) => (task_id, Err(e)),
        }
    }

    pub async fn next(&mut self, frontend: &WorkflowFrontend) -> Result<bool, SystemError> {
        // console::println(&format!("TOPOLOGY: {:?}", self.task_topology));

        // Collect all tasks that can be scheduled
        let mut task_ids = Vec::with_capacity(self.task_logic.len());
        let mut task_ops: Vec<Box<dyn TaskOperator<'exec, 'ast> + 'exec>> = Vec::with_capacity(self.task_logic.len());
        while !self.task_topology.is_empty() {
            // Get next task in topology
            let (task_id, waiting_for) = self.task_topology.top().clone();
            if waiting_for > 0 {
                break;
            }
            self.task_topology.pop();

            // Nothing to do?
            let status = self.task_graph.tasks[task_id].task_status.load(Ordering::SeqCst);
            if status == (TaskStatusCode::Skipped as u8) || status == (TaskStatusCode::Completed as u8) {
                for req_for in self.task_required_for[task_id].iter() {
                    self.task_topology.decrement_key(req_for);
                }
                continue;
            }
            // Register for execution if alive
            if self.task_graph.tasks[task_id].is_alive() {
                task_ids.push(task_id);
                task_ops.push(std::mem::replace(&mut self.task_logic[task_id], None).unwrap());
            }
        }
        if task_ids.is_empty() {
            return Ok(false);
        }
        // console::println(&format!("NEXT WORK ON: {:?}", task_ids));

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
            frontend.update_task_status(*task_id as u32, TaskStatusCode::Preparing, None);
        }
        frontend.flush_updates();
        let instance = self.instance.clone();
        let mut task_futures: futures::stream::FuturesUnordered<_> = task_ops
            .iter_mut()
            .enumerate()
            .map(|(task_op_id, op)| (task_ids[task_op_id], op))
            .filter(|(task_id, _op)| self.task_graph.tasks[*task_id].is_alive())
            .map(|(task_id, op)| (task_id, op, instance.context.snapshot()))
            .map(|(task_id, op, snap)| TaskScheduler::prepare_task(task_id, op, snap, frontend))
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
                    frontend.update_task_status(task_id as u32, TaskStatusCode::Prepared, None);
                }
                Err(e) => {
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Failed as u8, std::sync::atomic::Ordering::SeqCst);
                    frontend.update_task_status(task_id as u32, TaskStatusCode::Failed, Some(e.to_string()));
                }
            };
            frontend.flush_updates();
        }
        drop(task_futures);
        merge_into(snapshots, &self.instance.context)?;

        // XXX Opportunity to run shared computations after preparing every task

        // Execute all tasks
        for task_id in task_ids.iter() {
            let task = &self.task_graph.tasks[*task_id];
            if task.is_alive() {
                task.task_status
                    .store(TaskStatusCode::Executing as u8, std::sync::atomic::Ordering::SeqCst);
                frontend.update_task_status(*task_id as u32, TaskStatusCode::Executing, None);
            }
        }
        frontend.flush_updates();
        let mut task_futures: futures::stream::FuturesUnordered<_> = task_ops
            .iter_mut()
            .enumerate()
            .map(|(task_op_id, op)| (task_ids[task_op_id], op))
            .filter(|(task_id, _op)| self.task_graph.tasks[*task_id].is_alive())
            .map(|(task_id, op)| (task_id, op, instance.context.snapshot()))
            .map(|(task_id, op, snap)| TaskScheduler::execute_task(task_id, op, snap, frontend))
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
                    frontend.update_task_status(task_id as u32, TaskStatusCode::Completed, None);
                }
                Err(e) => {
                    self.task_graph.tasks[task_id]
                        .task_status
                        .store(TaskStatusCode::Failed as u8, std::sync::atomic::Ordering::SeqCst);
                    frontend.update_task_status(task_id as u32, TaskStatusCode::Failed, Some(e.to_string()));
                }
            };
            frontend.flush_updates();
        }
        merge_into(snapshots, &self.instance.context)?;

        // Update topology
        for task_id in task_ids.iter() {
            let task = &self.task_graph.tasks[*task_id];
            if task.is_alive() {
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
        api::workflow_frontend::run_task_status_updates,
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
        let task_graph = Arc::new(plan_tasks(&instance, None)?);

        // Run the scheduler
        let mut task_scheduler = TaskScheduler::schedule(&instance, &task_graph)?;
        let mut frontend = WorkflowFrontend::default();
        loop {
            let work_left = task_scheduler.next(&mut frontend).await?;
            if !work_left {
                break;
            }
        }
        let updates = frontend.flush_updates_manually();
        let task_status = run_task_status_updates(&updates);
        let failed: Vec<_> = task_status
            .iter()
            .filter(|(status, _)| *status == TaskStatusCode::Failed)
            .collect();
        assert!(failed.is_empty(), "{:?}", failed);

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
