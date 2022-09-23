use crate::analyzer::task_graph::TaskGraph;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DropVisTaskOperator<'exec, 'ast> {
    _instance: &'exec ProgramInstance<'ast>,
}

impl<'exec, 'ast> DropVisTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        _task_graph: &'exec TaskGraph,
        _task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            _instance: instance.clone(),
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for DropVisTaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
}
