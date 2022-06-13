use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateViewStatement, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateViewTask {
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl CreateViewTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a CreateViewStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::CreateView(view) => Ok(view),
            _ => Err(SystemError::InvalidStatementType("create view")),
        }
    }
}

#[async_trait(?Send)]
impl Task for CreateViewTask {
    async fn prepare(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, ctx: &TaskContext) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let stmt_select = stmt.statement.get();
        let script = print_ast_as_script_with_defaults(stmt_select);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
