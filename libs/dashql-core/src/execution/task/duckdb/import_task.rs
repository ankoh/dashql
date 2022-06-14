use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::import::{FileImport, HttpImport, Import};
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{ImportStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct ImportTask {
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

fn infer_import_method(url: &str) -> proto::ImportMethodType {
    if url.starts_with("http://") || url.starts_with("https://") {
        return proto::ImportMethodType::HTTP;
    } else if url.starts_with("file://") {
        return proto::ImportMethodType::FILE;
    }
    return proto::ImportMethodType::NONE;
}

impl ImportTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a ImportStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Import(fetch) => Ok(fetch),
            _ => Err(SystemError::InvalidStatementType("fetch")),
        }
    }
}

#[async_trait(?Send)]
impl Task for ImportTask {
    async fn prepare(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute(&mut self, ctx: &mut TaskContext) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let mut method = stmt.method.get();
        let mut url = None;

        // User specified uri?
        if let Some(from_uri_expr) = stmt.from_uri.get() {
            let from_uri = match from_uri_expr
                .evaluate(&mut ctx.evaluation_context)?
                .map(|v| format!("{}", v))
            {
                Some(uri) => uri,
                None => return Err(SystemError::InvalidImport(format!("{:?}", stmt))),
            };
            method = infer_import_method(&from_uri);
            url = Some(from_uri);
        }

        // XXX If none, resolve from extras
        let url = url.unwrap();

        // Register import
        let import = match method {
            proto::ImportMethodType::FILE => Import::File(FileImport { url: url }),
            proto::ImportMethodType::HTTP => Import::Http(HttpImport { url: url }),
            _ => return Err(SystemError::InvalidImport(format!("{:?}", stmt))),
        };
        ctx.imports_by_id.insert(self.task.object_id, import);
        Ok(())
    }
}
