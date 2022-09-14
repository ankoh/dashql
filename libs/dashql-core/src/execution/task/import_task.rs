use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_planner::TaskGraph;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{FileDataRef, HttpDataRef, TaskData, TestDataRef};
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{ImportStatement, Statement};
use async_trait::async_trait;
use dashql_proto as proto;

pub struct ImportTask<'ast> {
    pub state_id: usize,
    pub statement: &'ast ImportStatement<'ast>,
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

impl<'ast> ImportTask<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        task_graph: &Arc<TaskGraph>,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast ImportStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Import(i) => i,
            _ => return Err(SystemError::InvalidStatementType("expected import".to_string())),
        };
        Ok(Self {
            state_id: task.state_id,
            statement: stmt,
        })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for ImportTask<'ast> {
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
                    return Err(SystemError::URIUnsupported(
                        self.statement.from_uri.get_node_id(),
                        format!("{:?}", self.statement),
                    ))
                }
            };
            method = infer_import_method_from_url(&from_uri);
            url = Some(from_uri);
        }

        let url = match url {
            Some(url) => url,
            None => return Err(SystemError::NotImplemented("dynamic import urls".to_string())),
        };

        // Register import
        type ImportMethod = proto::ImportMethodType;
        let import = match method {
            ImportMethod::FILE => TaskData::FileDataRef(FileDataRef { name: name_string, url }),
            ImportMethod::HTTP => TaskData::HttpDataRef(HttpDataRef { name: name_string, url }),
            ImportMethod::TEST => {
                let url = ctx.base.runtime.resolve_test_data(&url).await?;
                TaskData::TestDataRef(TestDataRef { name: name_string, url })
            }
            _ => return Err(SystemError::NotImplemented(format!("import {:?}", method))),
        };
        let import = Arc::new(import);
        ctx.local_state.state_by_id.insert(self.state_id, import);
        Ok(())
    }
}
