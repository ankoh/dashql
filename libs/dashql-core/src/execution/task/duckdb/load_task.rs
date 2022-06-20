use crate::analyzer::task_planner::ProgramTask;
use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::Task;
use crate::grammar::{LoadStatement, Program, Statement};
use async_trait::async_trait;
use duckdbx_api::api::DatabaseConnection;
use std::rc::Rc;

pub struct LoadTask<'ast> {
    program: &'ast Program<'ast>,
    task: Rc<ProgramTask>,
    connection: Box<dyn DatabaseConnection>,
}

impl<'ast> LoadTask<'ast> {
    fn get_statement<'snap>(&self) -> Result<&'ast LoadStatement<'ast>, SystemError> {
        match &self.program.statements[self.task.origin_statement] {
            Statement::Load(load) => Ok(load),
            _ => Err(SystemError::InvalidStatementType("load")),
        }
    }
}

#[async_trait(?Send)]
impl<'ast> Task<'ast> for LoadTask<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        todo!()
    }

    async fn execute<'snap>(&mut self, ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        let stmt = self.get_statement()?;
        todo!()
    }
}
