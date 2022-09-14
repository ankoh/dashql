use std::sync::Arc;

use crate::analyzer::task_graph::TaskGraph;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DeclareTaskOperator<'ast> {
    instance: Arc<ProgramInstance<'ast>>,
}

impl<'ast> DeclareTaskOperator<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        _task_graph: &Arc<TaskGraph>,
        _task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            instance: instance.clone(),
        })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DeclareTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
}
