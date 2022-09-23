use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::execution::task_state::{TableRef, TaskData, ViewRef};
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::Statement;
use async_trait::async_trait;

pub struct DBCreateTableTaskOperator<'exec, 'ast> {
    statement: Statement<'ast>,
    task_graph: &'exec TaskGraph,
    task_id: usize,
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
        Ok(Self {
            statement: stmt,
            task_graph: task_graph,
            task_id,
        })
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
        let task = &self.task_graph.tasks[self.task_id];
        let connection = ctx.base.database_connection.as_ref();
        let script = print_ast_as_script_with_defaults(&self.statement);
        connection.run_query(&script).await?;
        match self.statement {
            Statement::Create(c) => {
                *task.data.write().unwrap() = Some(TaskData::TableRef(TableRef {
                    name: print_ast_as_script_with_defaults(&c.name.get()),
                }));
            }
            Statement::CreateAs(c) => {
                *task.data.write().unwrap() = Some(TaskData::TableRef(TableRef {
                    name: print_ast_as_script_with_defaults(&c.name.get()),
                }));
            }
            Statement::CreateView(v) => {
                *task.data.write().unwrap() = Some(TaskData::ViewRef(ViewRef {
                    name: print_ast_as_script_with_defaults(&v.name.get()),
                }));
            }
            _ => return Err(SystemError::NotImplemented("table statement type".to_string())),
        }
        Ok(())
    }
}
