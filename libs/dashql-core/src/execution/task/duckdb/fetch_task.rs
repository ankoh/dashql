use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{FetchStatement, Statement};
use async_trait::async_trait;
use dashql_proto::syntax as sx;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct FetchTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
    resolved_url: Option<String>,
}

fn infer_fetch_method(url: &str) -> sx::FetchMethodType {
    if url.starts_with("http://") || url.starts_with("https://") {
        return sx::FetchMethodType::HTTP;
    } else if url.starts_with("file://") {
        return sx::FetchMethodType::FILE;
    }
    return sx::FetchMethodType::NONE;
}

impl FetchTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a FetchStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Fetch(fetch) => Ok(fetch),
            _ => Err(SystemError::InvalidStatementType("fetch")),
        }
    }
}

#[async_trait(?Send)]
impl Task for FetchTask {
    async fn prepare(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, _ctx: &TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
