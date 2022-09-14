use std::sync::Arc;

use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_planner::TaskGraph;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::Statement;
use async_trait::async_trait;

pub struct DuckDBCreateTableTaskOperator<'ast> {
    statement: Statement<'ast>,
}

impl<'ast> DuckDBCreateTableTaskOperator<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        task_graph: &Arc<TaskGraph>,
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
        Ok(Self { statement: stmt })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBCreateTableTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let connection = ctx.base.database_connection.as_ref();
        let script = print_ast_as_script_with_defaults(&self.statement);
        connection.run_query(&script).await?;
        Ok(())
    }
}
