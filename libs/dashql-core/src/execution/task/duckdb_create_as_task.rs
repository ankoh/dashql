use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{CreateAsStatement, Statement};
use async_trait::async_trait;

pub struct DuckDBCreateAsTask<'ast> {
    statement: &'ast CreateAsStatement<'ast>,
}

impl<'ast> DuckDBCreateAsTask<'ast> {
    pub fn create(instance: &'ast ProgramInstance<'ast>, task: &'ast ProgramTask) -> Result<Self, SystemError> {
        let stmt_id = task.origin_statement;
        let stmt: &'ast CreateAsStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::CreateAs(c) => c,
            _ => return Err(SystemError::InvalidStatementType("expected create as")),
        };
        Ok(Self { statement: stmt })
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for DuckDBCreateAsTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let _script = print_ast_as_script_with_defaults(self.statement);
        todo!();
        //self.connection.run_query(&script).await?;
    }
}
