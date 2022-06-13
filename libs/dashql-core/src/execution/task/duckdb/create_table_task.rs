use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateStatement, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateTableTask {
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl CreateTableTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a CreateStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Create(tbl) => Ok(tbl),
            _ => Err(SystemError::InvalidStatementType("create table")),
        }
    }
}

#[async_trait(?Send)]
impl Task for CreateTableTask {
    async fn prepare(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, ctx: &TaskContext) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let script = print_ast_as_script_with_defaults(stmt);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
