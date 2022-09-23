use crate::{
    api::workflow_frontend::WorkflowFrontend, error::SystemError,
    execution::execution_context::ExecutionContextSnapshot,
};
use async_trait::async_trait;

#[async_trait(?Send)]
pub trait TaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(
        &mut self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError>;
    async fn execute<'snap>(
        &mut self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError>;
}
