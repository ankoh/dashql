use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateStatement, Program, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateTableTask<'ast> {
    program: &'ast Program<'ast>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> CreateTableTask<'ast> {
    fn get_statement<'snap>(&self) -> Result<&'ast CreateStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Create(tbl) => Ok(tbl),
            _ => Err(SystemError::InvalidStatementType("create table")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for CreateTableTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt = self.get_statement()?;
        let script = print_ast_as_script_with_defaults(stmt);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
