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
    connection: Box<dyn DatabaseConnection>,
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
    async fn prepare(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, ctx: &mut TaskContext) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let mut method = stmt.method.get();
        let mut url = None;

        // User specified uri?
        if let Some(from_uri_expr) = stmt.from_uri.get() {
            let from_uri = match from_uri_expr.evaluate(&mut ctx.expressions)?.map(|v| format!("{}", v)) {
                Some(uri) => uri,
                None => return Err(SystemError::InvalidFetchURI(format!("{:?}", &from_uri_expr))),
            };
            method = infer_fetch_method(&from_uri);
            url = Some(from_uri);
        }

        // XXX If none, resolve from extras
        match method {
            sx::FetchMethodType::FILE => (),
            sx::FetchMethodType::HTTP => (),
            _ => (),
        }

        todo!()
    }
}
