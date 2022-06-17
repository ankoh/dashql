use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import::{FileImport, HttpImport, Import};
use crate::execution::task::Task;
use crate::grammar::{ImportStatement, Program, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct ImportTask<'ast> {
    program: &'ast Program<'ast>,
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

impl<'ast> ImportTask<'ast> {
    fn get_statement<'snap>(
        &self,
        ctx: &ExecutionContextSnapshot<'ast, 'snap>,
    ) -> Result<&'ast ImportStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Import(fetch) => Ok(fetch),
            _ => Err(SystemError::InvalidStatementType("import")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for ImportTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt = self.get_statement(ctx)?;
        let mut method = stmt.method.get();
        let mut url = None;

        // User specified uri?
        // if let Some(from_uri_expr) = stmt.from_uri.get() {
        //     let from_uri = match from_uri_expr
        //         .evaluate(&mut state.expression_context)?
        //         .map(|v| format!("{}", v))
        //     {
        //         Some(uri) => uri,
        //         None => return Err(SystemError::InvalidImport(format!("{:?}", stmt))),
        //     };
        //     method = infer_import_method(&from_uri);
        //     url = Some(from_uri);
        // }

        // XXX If none, resolve from extras
        let url = url.unwrap();

        // Register import
        let import = match method {
            proto::ImportMethodType::FILE => Import::File(FileImport { url: url }),
            proto::ImportMethodType::HTTP => Import::Http(HttpImport { url: url }),
            _ => return Err(SystemError::InvalidImport(format!("{:?}", stmt))),
        };
        //state.imports_by_id.insert(self.task.object_id, import);
        Ok(())
    }
}
