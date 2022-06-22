use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateViewStatement, Program};
use async_trait::async_trait;
use duckdbx_api::DatabaseConnection;
use std::rc::Rc;

pub struct DuckDBCreateViewTask<'ast> {
    _program: &'ast Program<'ast>,
    statement: &'ast CreateViewStatement<'ast>,
    _task: Rc<ProgramTask>,
    connection: DatabaseConnection,
}

impl<'ast> DuckDBCreateViewTask<'ast> {}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for DuckDBCreateViewTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let script = print_ast_as_script_with_defaults(self.statement);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
