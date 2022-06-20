use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::import_info::{FileImportInfo, HttpImportInfo, ImportInfo, TestImportInfo};
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::ImportStatement;
use async_trait::async_trait;
use dashql_proto as proto;

pub struct ImportTask<'ast> {
    statement: &'ast ImportStatement<'ast>,
}

fn infer_import_method_from_url(url: &str) -> proto::ImportMethodType {
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
        let name = self.statement.name.get();
        let name_string = print_ast_as_script_with_defaults(&name);
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
            method = infer_import_method_from_url(&from_uri);
            url = Some(from_uri);
        }

        // XXX If none, resolve from extras
        let url = url.unwrap();

        // Register import
        type ImportMethod = proto::ImportMethodType;
        let import = match method {
            ImportMethod::FILE => ImportInfo::File(FileImportInfo { name: name_string, url }),
            ImportMethod::HTTP => ImportInfo::Http(HttpImportInfo { name: name_string, url }),
            ImportMethod::TEST => ImportInfo::Test(TestImportInfo { name: name_string, url }),
            _ => return Err(SystemError::NotImplemented(format!("import {:?}", method))),
        };
        ctx.local_state.imports_by_name.insert(name, import);
        Ok(())
    }
}
