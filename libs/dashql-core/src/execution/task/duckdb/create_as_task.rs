use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateAsStatement, Program, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateAsTask<'ast> {
    program: &'ast Program<'ast>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> CreateAsTask<'ast> {
    fn get_statement<'snap>(&self) -> Result<&'ast CreateAsStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::CreateAs(create) => Ok(create),
            _ => Err(SystemError::InvalidStatementType("create as")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for CreateAsTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt = self.get_statement()?;
        let stmt_select = stmt.statement.get();
        let script = print_ast_as_script_with_defaults(stmt_select);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
