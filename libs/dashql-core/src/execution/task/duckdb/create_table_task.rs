use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{CreateStatement, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct CreateTableTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
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
    async fn prepare(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
