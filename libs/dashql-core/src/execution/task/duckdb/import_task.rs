use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import::{FileImport, HttpImport, Import, TestImport};
use crate::execution::task::Task;
use crate::grammar::{ImportStatement, Program, Statement};
use async_trait::async_trait;
use dashql_proto as proto;
use std::rc::Rc;

pub struct ImportTask<'ast> {
    program: &'ast Program<'ast>,
    statement: &'ast ImportStatement<'ast>,
    task: Rc<ProgramTask>,
}

fn infer_import_method(url: &str) -> proto::ImportMethodType {
    if url.starts_with("http://") || url.starts_with("https://") {
        return proto::ImportMethodType::HTTP;
    } else if url.starts_with("file://") {
        return proto::ImportMethodType::FILE;
    } else if url.starts_with("test://") {
        return proto::ImportMethodType::TEST;
    }
    return proto::ImportMethodType::NONE;
}

impl<'ast> ImportTask<'ast> {}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for ImportTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt_name = self.statement.name.get();
        let mut method = self.statement.method.get();
        let mut url = None;

        // User specified uri?
        if let Some(from_uri_expr) = self.statement.from_uri.get() {
            let from_uri = match from_uri_expr.evaluate(ctx)?.map(|v| format!("{}", v)) {
                Some(uri) => uri,
                None => {
                    return Err(SystemError::ImportURIUnsupported(
                        self.statement.from_uri.get_node_id(),
                        format!("{:?}", self.statement),
                    ))
                }
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
            proto::ImportMethodType::TEST => Import::Test(TestImport { url: url }),
            _ => return Err(SystemError::NotImplemented(format!("import {:?}", method))),
        };
        ctx.local.imports_by_name.insert(stmt_name, import);
        Ok(())
    }
}
