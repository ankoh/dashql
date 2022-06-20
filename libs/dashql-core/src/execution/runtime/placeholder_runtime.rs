use crate::{
    error::SystemError,
    execution::{execution_context::ExecutionContextSnapshot, import_info::ImportInfo},
};
use async_trait::async_trait;

use super::{Runtime, RuntimeDataHandle};

#[derive(Debug)]
pub struct PlaceholderRuntime {}

#[async_trait(?Send)]
impl Runtime for PlaceholderRuntime {
    async fn import_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _import: &ImportInfo,
    ) -> Result<RuntimeDataHandle, SystemError> {
        panic!("importing data not implemented");
    }

    async fn load_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _data: RuntimeDataHandle,
    ) -> Result<RuntimeDataHandle, SystemError> {
        panic!("loading data not implemented");
    }
}
