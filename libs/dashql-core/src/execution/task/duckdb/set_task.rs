use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::Program;
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct SetTask<'a> {
    program: &'a Program<'a>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

#[async_trait(?Send)]
impl<'a> Task<'a> for SetTask<'a> {
    async fn prepare(&mut self, _ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        todo!()
    }
}
