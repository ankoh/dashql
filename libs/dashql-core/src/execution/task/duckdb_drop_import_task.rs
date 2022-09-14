use std::sync::Arc;

use crate::analyzer::task_planner::TaskGraph;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::console;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DuckDBDropImportTaskOperator<'ast> {
    instance: Arc<ProgramInstance<'ast>>,
}

impl<'ast> DuckDBDropImportTaskOperator<'ast> {
    pub fn create(
        instance: &Arc<ProgramInstance<'ast>>,
        _task_graph: &Arc<TaskGraph>,
        _task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            instance: instance.clone(),
        })
    }
}

#[async_trait(?Send)]
impl<'ast> TaskOperator<'ast> for DuckDBDropImportTaskOperator<'ast> {
    async fn prepare<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        console::println("DROP IMPORT: PREPARE");
        Ok(())
    }
    async fn execute<'snap>(&mut self, _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>) -> Result<(), SystemError> {
        console::println("DROP IMPORT: EXECUTE");
        Ok(())
    }
}
