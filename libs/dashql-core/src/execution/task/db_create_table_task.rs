use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::table_metadata::resolve_table_metadata;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TableRef, TaskData};
use crate::grammar::ast_to_sql::NoopExpressionFilter;
use crate::grammar::script_writer::{
    print_ast_as_script_with_defaults, print_script, ScriptTextConfig, ScriptWriter, ToSQL,
};
use crate::grammar::Statement;
use async_trait::async_trait;

pub struct DBCreateTableTaskOperator<'exec, 'ast> {
    statement: Statement<'ast>,
    task: &'exec Task,
}

impl<'exec, 'ast> DBCreateTableTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        task_graph: &'exec TaskGraph,
        task_id: usize,
    ) -> Result<Self, SystemError> {
        let task = &task_graph.tasks[task_id];
        let stmt_id = task.origin_statement.unwrap();
        let stmt = instance.program.statements[stmt_id].clone();
        match &stmt {
            Statement::Create(_) | Statement::CreateAs(_) | Statement::CreateView(_) | Statement::Select(_) => {}
            _ => {
                return Err(SystemError::InvalidStatementType(format!(
                    "expected create, got: {:?}",
                    &stmt
                )))
            }
        };
        Ok(Self { statement: stmt, task })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for DBCreateTableTaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(
        &mut self,
        ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        let script_text_config = ScriptTextConfig::default();
        let script_writer = ScriptWriter::new();
        let script_filter = NoopExpressionFilter::default();
        let script_text = self.statement.to_sql(&script_writer, &script_filter);
        let script_text_str = print_script(&script_text, &script_text_config);

        let connection = ctx.base.database_connection.as_ref();
        connection.run_query(&script_text_str).await?;

        match self.statement {
            Statement::Create(c) => {
                let name = print_ast_as_script_with_defaults(&c.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::TableRef(TableRef {
                    name,
                    metadata,
                    is_view: false,
                }));
            }
            Statement::CreateAs(c) => {
                let name = print_ast_as_script_with_defaults(&c.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::TableRef(TableRef {
                    name,
                    metadata,
                    is_view: false,
                }));
            }
            Statement::CreateView(v) => {
                let name = print_ast_as_script_with_defaults(&v.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::TableRef(TableRef {
                    name,
                    metadata,
                    is_view: true,
                }));
            }
            _ => return Err(SystemError::NotImplemented("table statement type".to_string())),
        }
        Ok(())
    }
}
