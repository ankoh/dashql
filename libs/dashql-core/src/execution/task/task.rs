use crate::{error::SystemError, execution::execution_context::ExecutionContextSnapshot};
use async_trait::async_trait;

#[async_trait(?Send)]
pub trait TaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError>;
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError>;
}
