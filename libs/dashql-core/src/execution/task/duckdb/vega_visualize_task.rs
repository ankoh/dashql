use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::task::task_context::TaskContext;
use crate::execution::task::Task;
use crate::grammar::{Program, Statement, VizStatement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct VegaVisualizeTask<'a> {
    program: &'a Program<'a>,
    task: Rc<ProgramTask>,
    conn: Box<dyn DatabaseConnection>,
}

impl<'a> VegaVisualizeTask<'a> {
    fn get_statement(&self, ctx: &TaskContext<'a>) -> Result<&'a VizStatement<'a>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Viz(viz) => Ok(viz),
            _ => Err(SystemError::InvalidStatementType("viz")),
        }
    }
}

#[async_trait(?Send)]
impl<'a> Task<'a> for VegaVisualizeTask<'a> {
    async fn prepare(&mut self, _ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute(&mut self, ctx: &TaskContext<'a>) -> Result<(), SystemError> {
        todo!()
    }
}
