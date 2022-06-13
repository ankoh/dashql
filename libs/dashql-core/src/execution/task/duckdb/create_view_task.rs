use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{CreateViewStatement, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateViewTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl CreateViewTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a CreateViewStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::CreateView(view) => Ok(view),
            _ => Err(SystemError::InvalidStatementType("view")),
        }
    }
}

#[async_trait(?Send)]
impl Task for CreateViewTask {
    async fn prepare(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
