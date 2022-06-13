use crate::analyzer::task_data::{SetTaskData, TaskData};
use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct SetTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl SetTask {
    fn get_data<'a>(&'a self) -> Result<&'a SetTaskData, SystemError> {
        match &self.task.data {
            TaskData::Set(data) => Ok(data),
            _ => Err(SystemError::InvalidTaskData(self.task.origin_statement)),
        }
    }
}

impl Task for SetTask {
    fn prepare(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    fn will_execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    fn execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
