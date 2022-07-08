use crate::analyzer::task::Task;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::database::DatabaseConnection;
use crate::grammar::Program;
use async_trait::async_trait;
use std::rc::Rc;

pub struct SetTask<'ast> {
    _program: &'ast Program<'ast>,
    _task: Rc<Task>,
    _connection: DatabaseConnection,
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for SetTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
}
