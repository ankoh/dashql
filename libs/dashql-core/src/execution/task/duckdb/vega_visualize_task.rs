use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::{Program, Statement, VizStatement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct VegaVisualizeTask<'ast> {
    program: &'ast Program<'ast>,
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl<'ast> VegaVisualizeTask<'ast> {
    fn get_statement<'snap>(
        &self,
        ctx: &ExecutionContextSnapshot<'ast, 'snap>,
    ) -> Result<&'ast VizStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Viz(viz) => Ok(viz),
            _ => Err(SystemError::InvalidStatementType("viz")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for VegaVisualizeTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute<'snap>(&mut self, ctx: &ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        todo!()
    }
}
