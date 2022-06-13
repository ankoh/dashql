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
    async fn prepare(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
