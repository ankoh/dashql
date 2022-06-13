use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{CreateAsStatement, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateAsTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl CreateAsTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a CreateAsStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::CreateAs(create) => Ok(create),
            _ => Err(SystemError::InvalidStatementType("create as")),
        }
    }
}

#[async_trait(?Send)]
impl Task for CreateAsTask {
    async fn prepare(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let stmt_select = stmt.statement.get();
        let script = print_ast_as_script_with_defaults(stmt_select);
        self.connection.run_query(&script).await?;
        Ok(())
    }
}
