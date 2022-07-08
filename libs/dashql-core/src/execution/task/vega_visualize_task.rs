use crate::analyzer::program_instance::ProgramInstance;
use crate::analyzer::task::Task;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::grammar::{Statement, VizStatement};
use async_trait::async_trait;

pub struct VegaVisualizeTaskOperator<'ast> {
    _statement: &'ast VizStatement<'ast>,
}

impl<'ast> VegaVisualizeTaskOperator<'ast> {
    pub fn create(instance: &'ast ProgramInstance<'ast>, task: &'ast Task) -> Result<Self, SystemError> {
        let stmt_id = task.origin_statement.unwrap();
        let stmt: &'ast VizStatement<'ast> = match instance.program.statements[stmt_id] {
            Statement::Viz(v) => v,
            _ => return Err(SystemError::InvalidStatementType("expected viz")),
        };
        Ok(Self { _statement: stmt })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for VegaVisualizeTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        Ok(())
    }
}
