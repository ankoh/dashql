use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::console::println;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DropVisTaskOperator<'exec, 'ast> {
    _instance: &'exec ProgramInstance<'ast>,
    task: &'exec Task,
}

impl<'exec, 'ast> DropVisTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            _instance: instance,
            task: &task_graph.tasks[task_id],
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for DropVisTaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        println(&format!("VIZ DROP ID {}", self.task.data_id));
        frontend.delete_task_data(self.task.data_id as u32);
        Ok(())
    }
}
