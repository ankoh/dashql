use crate::analyzer::task_graph::TaskGraph;
use crate::api::workflow_frontend::WorkflowFrontend;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::task::TaskOperator;
use crate::external::console;
use crate::{analyzer::program_instance::ProgramInstance, error::SystemError};
use async_trait::async_trait;

pub struct DBDropImportTaskOperator<'exec, 'ast> {
    _instance: &'exec ProgramInstance<'ast>,
}

impl<'exec, 'ast> DBDropImportTaskOperator<'exec, 'ast> {
    pub fn create(
        instance: &'exec ProgramInstance<'ast>,
        _task_graph: &'exec TaskGraph,
        _task_id: usize,
    ) -> Result<Self, SystemError> {
        Ok(Self {
            _instance: instance.clone(),
        })
    }
}

#[async_trait(?Send)]
impl<'exec, 'ast> TaskOperator<'exec, 'ast> for DBDropImportTaskOperator<'exec, 'ast> {
    async fn prepare<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        console::println("DROP IMPORT: PREPARE");
        Ok(())
    }
    async fn execute<'snap>(
        &mut self,
        _ctx: &mut ExecutionContextSnapshot<'ast, 'snap>,
        _frontend: &WorkflowFrontend,
    ) -> Result<(), SystemError> {
        console::println("DROP IMPORT: EXECUTE");
        Ok(())
    }
}
