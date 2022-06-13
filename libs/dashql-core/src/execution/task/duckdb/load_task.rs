use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{LoadStatement, Statement};
use async_trait::async_trait;
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

impl LoadTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a LoadStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Load(load) => Ok(load),
            _ => Err(SystemError::InvalidStatementType("load")),
        }
    }
}

#[async_trait(?Send)]
impl Task for LoadTask {
    async fn prepare(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
