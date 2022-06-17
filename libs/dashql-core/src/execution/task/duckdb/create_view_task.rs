use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateViewStatement, Program, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateViewTask<'ast> {
    program: &'ast Program<'ast>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> CreateViewTask<'ast> {
    fn get_statement<'snap>(
        &self,
        ctx: &ExecutionContextSnapshot<'ast, 'snap>,
    ) -> Result<&'ast CreateViewStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::CreateView(view) => Ok(view),
            _ => Err(SystemError::InvalidStatementType("create view")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for CreateViewTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let stmt_select = stmt.statement.get();
        let script = print_ast_as_script_with_defaults(stmt_select);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
