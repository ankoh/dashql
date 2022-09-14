use crate::{
    error::SystemError,
    execution::{execution_context::ExecutionContextSnapshot, task_state::TaskState},
};
use async_trait::async_trait;

use super::{Runtime, RuntimeDataHandle};

#[derive(Debug)]
pub struct DummyRuntime {}

#[async_trait(?Send)]
impl Runtime for DummyRuntime {
    async fn resolve_test_data(&self, url: &str) -> Result<String, SystemError> {
        Ok(url.to_string())
    }

    async fn import_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _info: &TaskState,
    ) -> Result<RuntimeDataHandle, SystemError> {
        panic!("importing data not implemented");
    }

    async fn load_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _data: RuntimeDataHandle,
        _info: &TaskState,
    ) -> Result<(), SystemError> {
        panic!("loading data not implemented");
    }
}
