use crate::analyzer::task_data::{TaskData, VizTaskData};
use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct VegaVisualizeTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl VegaVisualizeTask {
    fn get_data<'a>(&'a self) -> Result<&'a VizTaskData, SystemError> {
        match &self.task.data {
            TaskData::Viz(data) => Ok(data),
            _ => Err(SystemError::InvalidTaskData(self.task.origin_statement)),
        }
    }
}

impl Task for VegaVisualizeTask {
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
