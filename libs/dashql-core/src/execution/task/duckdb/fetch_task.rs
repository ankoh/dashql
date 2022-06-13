use crate::analyzer::task_data::{FetchTaskData, TaskData};
use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use dashql_proto::syntax as sx;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct FetchTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl FetchTask {
    fn get_data<'a>(&'a self) -> Result<&'a FetchTaskData, SystemError> {
        match &self.task.data {
            TaskData::Fetch(data) => Ok(data),
            _ => Err(SystemError::InvalidTaskData(self.task.origin_statement)),
        }
    }
}

fn infer_fetch_method(url: &str) -> sx::FetchMethodType {
    if url.starts_with("http://") || url.starts_with("https://") {
        return sx::FetchMethodType::HTTP;
    } else if url.starts_with("file://") {
        return sx::FetchMethodType::FILE;
    }
    return sx::FetchMethodType::NONE;
}

impl Task for FetchTask {
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
