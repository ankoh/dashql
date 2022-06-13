use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct SetTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

#[async_trait(?Send)]
impl Task for SetTask {
    async fn prepare(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
