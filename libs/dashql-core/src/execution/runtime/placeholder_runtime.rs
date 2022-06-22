use crate::{
    error::SystemError,
    execution::{execution_context::ExecutionContextSnapshot, import_info::ImportInfo, load_info::LoadInfo},
};
use async_trait::async_trait;
use duckdbx_api::DatabaseInstance;

use super::{Runtime, RuntimeDataHandle};

#[derive(Debug)]
pub struct PlaceholderRuntime {}

#[async_trait(?Send)]
impl Runtime for PlaceholderRuntime {
    async fn resolve_test_data(&self, url: &str) -> Result<String, SystemError> {
        Ok(url.to_string())
    }

    async fn import_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _info: &ImportInfo,
    ) -> Result<RuntimeDataHandle, SystemError> {
        panic!("importing data not implemented");
    }

    async fn load_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _data: RuntimeDataHandle,
        _info: &LoadInfo,
    ) -> Result<(), SystemError> {
        panic!("loading data not implemented");
    }
}
