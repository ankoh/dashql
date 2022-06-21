use super::{
    execution_context::{ExecutionContext, ExecutionContextSnapshot, ExecutionState},
    task::Task,
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
    program: &'ast ProgramInstance<'ast>,
    /// The task class
    task_class: TaskClass,
    /// The derived task logic
    task_logic: Vec<Option<Box<dyn Task<'ast>>>>,
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

fn translate_program_task<'ast>(task: &ProgramTask) -> Result<Option<Box<dyn Task<'ast>>>, SystemError> {
    let logic = match task.task_type {
        ProgramTaskType::None => None,
        ProgramTaskType::CreateAs => todo!(),
        ProgramTaskType::CreateTable => todo!(),
        ProgramTaskType::CreateView => todo!(),
        ProgramTaskType::CreateViz => todo!(),
        ProgramTaskType::Import => todo!(),
        ProgramTaskType::Input => todo!(),
        ProgramTaskType::Load => todo!(),
        ProgramTaskType::ModifyTable => todo!(),
        ProgramTaskType::Set => todo!(),
        ProgramTaskType::UpdateViz => todo!(),
    };
    Ok(logic)
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
            program,
            task_class: TaskClass::SetupTask,
            task_logic: logic,
            task_topology: TopologicalSort::new(topo),
            task_alive: alive,
            task_required_for: required_for,
        })
    }

    /// Create program scheduler
    pub fn schedule_program(
        program: &'ast ProgramInstance<'ast>,
        task_graph: &'ast TaskGraph,
    ) -> Result<Self, SystemError> {
        let n = task_graph.setup_tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        let mut alive = Vec::with_capacity(n);
        let mut required_for = Vec::with_capacity(n);
        for (program_id, program_task) in task_graph.program_tasks.iter().enumerate() {
            topo.push((program_id, program_task.depends_on.len()));
            logic.push(translate_program_task(program_task)?);
            alive.push(program_task.task_status.get() == TaskStatusCode::Pending);
            required_for.push(program_task.required_for.as_slice());
        }
        Ok(Self {
            program,
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
        task: &'task mut Box<dyn Task<'ast>>,
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
        task: &'task mut Box<dyn Task<'ast>>,
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
        loop {
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
            .map(|(task_id, task)| (task_id, task, self.program.context.snapshot()))
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
        merge_into(snapshots, &self.program.context)?;

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
            .map(|(task_id, task)| (task_id, task, self.program.context.snapshot()))
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
        merge_into(snapshots, &self.program.context)?;

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
    pub use super::*;

    struct QueryTest {
        pub query: &'static str,
        pub output: &'static str,
    }

    async fn test_scheduler(script: &'static str, tests: &'static [QueryTest]) -> Result<(), SystemError> {
        Ok(())
    }

    #[tokio::test]
    async fn test_load_0() -> Result<(), SystemError> {
        test_scheduler(
            r#"
import lineitem_data from 'test://tpch/0_01/lineitem.parquet';
load lineitem from lineitem_data using parquet;
vis lineitem using table;
        "#,
            &[QueryTest {
                query: "select count(*) from lineitem",
                output: "42",
            }],
        )
        .await?;
        Ok(())
    }
}
