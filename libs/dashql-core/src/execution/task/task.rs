use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use async_trait::async_trait;

#[async_trait(?Send)]
pub trait Task {
    async fn prepare(&mut self, ctx: &TaskContext) -> Result<(), SystemError>;
    async fn execute(&mut self, ctx: &TaskContext) -> Result<(), SystemError>;
}
