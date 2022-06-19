use bitvec::prelude::BitVec;

use crate::{
    analyzer::{
        program_instance::ProgramInstance,
        task_planner::{ProgramTask, ProgramTaskType, SetupTask, SetupTaskType, TaskGraph},
    },
    error::SystemError,
    utils::topological_sort::TopologicalSort,
};

use super::{
    execution_context::{ExecutionContext, ExecutionContextData, ExecutionContextSnapshot},
    task::Task,
};

pub struct TaskScheduler<'ast> {
    /// The program
    program: &'ast ProgramInstance<'ast>,
    /// The task graph
    task_graph: &'ast TaskGraph,

    /// The derived task logic
    task_logic: Vec<Option<Box<dyn Task<'ast>>>>,
    /// The task topology
    task_topology: TopologicalSort<usize>,

    /// Scheduled tasks
    scheduled_tasks: BitVec,
    /// Completed tasks
    completed_tasks: BitVec,
    /// Failed tasks
    failed_tasks: BitVec,

    /// The errors (if any)
    task_errors: Vec<(usize, SystemError)>,
}

fn translate_setup_task<'ast>(task: &SetupTask) -> Option<Box<dyn Task<'ast>>> {
    match task.task_type {
        SetupTaskType::None => None,
        SetupTaskType::DropBlob => todo!(),
        SetupTaskType::DropInput => todo!(),
        SetupTaskType::DropTable => todo!(),
        SetupTaskType::DropView => todo!(),
        SetupTaskType::DropViz => todo!(),
        SetupTaskType::Unset => todo!(),
    }
}

fn translate_program_task<'ast>(task: &ProgramTask) -> Option<Box<dyn Task<'ast>>> {
    match task.task_type {
        ProgramTaskType::None => todo!(),
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
    }
}

impl<'ast> TaskScheduler<'ast> {
    /// Schedule setup tasks
    pub fn schedule_setup_tasks(program: &'ast ProgramInstance<'ast>, task_graph: &'ast TaskGraph) -> Self {
        let n = task_graph.setup_tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        for (setup_id, setup_task) in task_graph.setup_tasks.iter().enumerate() {
            topo.push((setup_id, setup_task.depends_on.len()));
            logic.push(translate_setup_task(setup_task));
        }
        let mut sched = Self {
            program,
            task_graph,
            task_logic: logic,
            task_topology: TopologicalSort::new(topo),
            scheduled_tasks: Default::default(),
            completed_tasks: Default::default(),
            failed_tasks: Default::default(),
            task_errors: Vec::new(),
        };
        sched.scheduled_tasks.resize(n, false);
        sched.completed_tasks.resize(n, false);
        sched.failed_tasks.resize(n, false);
        sched
    }

    /// Schedule program tasks
    pub fn schedule_program_tasks(program: &'ast ProgramInstance<'ast>, task_graph: &'ast TaskGraph) -> Self {
        let n = task_graph.setup_tasks.len();
        let mut logic = Vec::with_capacity(n);
        let mut topo = Vec::with_capacity(n);
        for (program_id, program_task) in task_graph.program_tasks.iter().enumerate() {
            topo.push((program_id, program_task.depends_on.len()));
            logic.push(translate_program_task(program_task));
        }
        let mut sched = Self {
            program,
            task_graph,
            task_logic: logic,
            task_topology: TopologicalSort::new(topo),
            scheduled_tasks: Default::default(),
            completed_tasks: Default::default(),
            failed_tasks: Default::default(),
            task_errors: Vec::new(),
        };
        sched.scheduled_tasks.resize(n, false);
        sched.completed_tasks.resize(n, false);
        sched.failed_tasks.resize(n, false);
        sched
    }

    /// Prepare a task
    async fn prepare_task<'snap>(
        task: &mut Box<dyn Task<'ast>>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError> {
        task.prepare(&mut snapshot).await?;
        Ok(snapshot)
    }

    /// Execute a task
    async fn execute_task<'snap>(
        task: &mut Box<dyn Task<'ast>>,
        mut snapshot: ExecutionContextSnapshot<'ast, 'snap>,
    ) -> Result<ExecutionContextSnapshot<'ast, 'snap>, SystemError> {
        task.execute(&mut snapshot).await?;
        Ok(snapshot)
    }

    pub async fn next(&mut self) -> Result<bool, SystemError> {
        // Collect all tasks that can be scheduled
        let mut task_ids = Vec::with_capacity(self.task_logic.len());
        let mut tasks = Vec::with_capacity(self.task_logic.len());
        loop {
            let (task_id, waiting_for) = self.task_topology.top();
            if *waiting_for > 0 {
                break;
            }
            task_ids.push(*task_id);
            tasks.push(std::mem::replace(&mut self.task_logic[*task_id], None).unwrap());
            self.task_topology.pop();
        }
        if task_ids.is_empty() {
            return Ok(false);
        }
        for task_id in task_ids.iter() {
            self.scheduled_tasks.set(*task_id, true);
        }

        // Merge execution context data
        let merge_into =
            |local: Vec<ExecutionContextData<'ast>>, global: &ExecutionContext<'ast>| -> Result<(), SystemError> {
                let mut global = global.try_write_global()?;
                for data in local {
                    data.merge_into(&mut global);
                }
                Ok(())
            };

        // Prepare all tasks
        let task_futures = tasks
            .iter_mut()
            .map(|task| (task, self.program.execution_context.snapshot()))
            .map(|(task, snap)| TaskScheduler::prepare_task(task, snap));
        let mut task_results = futures::future::join_all(task_futures).await;
        let mut task_data = Vec::with_capacity(task_results.len());
        for (task_idx, task_result) in task_results.drain(..).enumerate() {
            let task_id = task_ids[task_idx];
            match task_result {
                Ok(snap) => {
                    task_data.push(snap.finish());
                    self.completed_tasks.set(task_id, true);
                }
                Err(e) => {
                    self.task_errors.push((task_id, e));
                    self.failed_tasks.set(task_id, true);
                }
            }
        }
        merge_into(task_data, &self.program.execution_context)?;

        // Execute all tasks
        let task_futures = tasks
            .iter_mut()
            .map(|task| (task, self.program.execution_context.snapshot()))
            .map(|(task, snap)| TaskScheduler::execute_task(task, snap));
        let mut task_results = futures::future::join_all(task_futures).await;
        let mut task_data = Vec::with_capacity(task_results.len());
        for (task_idx, task_result) in task_results.drain(..).enumerate() {
            let task_id = task_ids[task_idx];
            match task_result {
                Ok(snap) => {
                    task_data.push(snap.finish());
                    self.completed_tasks.set(task_id, true);
                }
                Err(e) => {
                    self.task_errors.push((task_id, e));
                    self.failed_tasks.set(task_id, true);
                }
            }
        }
        merge_into(task_data, &self.program.execution_context)?;

        let call_again = !self.task_topology.is_empty();
        Ok(call_again)
    }
}

pub struct TaskSchedulerStateMachine<'ast> {
    /// The program
    program: &'ast ProgramInstance<'ast>,
    /// The task graph
    task_graph: &'ast TaskGraph,

    /// The setup tasks
    setup_scheduler: TaskScheduler<'ast>,
    /// The program tasks
    program_scheduler: TaskScheduler<'ast>,
}
