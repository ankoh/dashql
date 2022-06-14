use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateStatement, Program, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateTableTask<'a> {
    program: &'a Program<'a>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'a> CreateTableTask<'a> {
    fn get_statement(&self, ctx: &TaskContext<'a>) -> Result<&'a CreateStatement<'a>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Create(tbl) => Ok(tbl),
            _ => Err(SystemError::InvalidStatementType("create table")),
        }
    }
}

#[async_trait(?Send)]
impl<'a> Task<'a> for CreateTableTask<'a> {
    async fn prepare(&mut self, _ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        let stmt = self.get_statement(&ctx)?;
        let script = print_ast_as_script_with_defaults(stmt);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
