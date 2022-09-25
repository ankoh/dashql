use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::table_metadata::resolve_table_metadata;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TableRef, TaskData, ViewRef};
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
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
        let connection = ctx.base.database_connection.as_ref();
        let script = print_ast_as_script_with_defaults(&self.statement);
        connection.run_query(&script).await?;

        match self.statement {
            Statement::Create(c) => {
                let name = print_ast_as_script_with_defaults(&c.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::TableRef(TableRef { name, metadata }));
            }
            Statement::CreateAs(c) => {
                let name = print_ast_as_script_with_defaults(&c.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::TableRef(TableRef { name, metadata }));
            }
            Statement::CreateView(v) => {
                let name = print_ast_as_script_with_defaults(&v.name.get());
                let metadata = resolve_table_metadata(ctx, &name).await?;
                *self.task.data.write().unwrap() = Some(TaskData::ViewRef(ViewRef { name, metadata }));
            }
            _ => return Err(SystemError::NotImplemented("table statement type".to_string())),
        }
        Ok(())
    }
}
