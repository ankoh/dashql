use async_trait::async_trait;

use crate::{
    error::SystemError,
    execution::{execution_context::ExecutionContextSnapshot, task_state::TaskData},
};

pub type RuntimeDataHandle = u64;

#[async_trait(?Send)]
pub trait Runtime: std::fmt::Debug {
    async fn resolve_test_data(&self, url: &str) -> Result<String, SystemError>;

    async fn import_data<'ast, 'snap>(
        &self,
        ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        info: &TaskData,
    ) -> Result<RuntimeDataHandle, SystemError>;

    async fn load_data<'ast, 'snap>(
        &self,
        ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        data: RuntimeDataHandle,
        info: &TaskData,
    ) -> Result<(), SystemError>;
}
