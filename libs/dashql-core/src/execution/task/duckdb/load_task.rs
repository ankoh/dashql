use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use dashql_proto::syntax as sx;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct LoadTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

fn infer_load_method(url: &str) -> sx::LoadMethodType {
    if url.ends_with(".parquet") {
        return sx::LoadMethodType::PARQUET;
    } else if url.ends_with(".json") {
        return sx::LoadMethodType::JSON;
    } else if url.ends_with(".csv") {
        return sx::LoadMethodType::CSV;
    }
    return sx::LoadMethodType::NONE;
}

impl Task for LoadTask {
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
