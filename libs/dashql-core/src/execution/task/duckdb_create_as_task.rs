use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateAsStatement, Program};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct DuckDBCreateAsTask<'ast> {
    _program: &'ast Program<'ast>,
    statement: &'ast CreateAsStatement<'ast>,
    _task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> DuckDBCreateAsTask<'ast> {}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for DuckDBCreateAsTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let script = print_ast_as_script_with_defaults(self.statement);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
