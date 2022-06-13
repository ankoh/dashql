use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{Statement, VizStatement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct VegaVisualizeTask {
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl VegaVisualizeTask {
    fn get_statement<'a>(&self, ctx: &TaskContext<'a>) -> Result<&'a VizStatement<'a>, SystemError> {
        match &ctx.program.statements[self.task.origin_statement] {
            Statement::Viz(viz) => Ok(viz),
            _ => Err(SystemError::InvalidStatementType("viz")),
        }
    }
}

#[async_trait(?Send)]
impl Task for VegaVisualizeTask {
    async fn prepare(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, _ctx: &mut TaskContext) -> Result<(), SystemError> {
        todo!()
    }
}
