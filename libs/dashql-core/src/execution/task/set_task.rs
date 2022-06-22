use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::Program;
use async_trait::async_trait;
use duckdbx_api::DatabaseConnection;
use std::rc::Rc;

pub struct SetTask<'ast> {
    _program: &'ast Program<'ast>,
    _task: Rc<ProgramTask>,
    _connection: DatabaseConnection,
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for SetTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
}
