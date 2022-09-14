use crate::{
    error::SystemError,
    execution::{execution_context::ExecutionContextSnapshot, task_state::TaskState},
};
use async_trait::async_trait;
use std::sync::Arc;
use std::{env, path::Path};

use crate::external::{Runtime, RuntimeDataHandle};

#[derive(Debug)]
pub struct NativeRuntime {}

#[async_trait(?Send)]
impl Runtime for NativeRuntime {
    async fn resolve_test_data(&self, url: &str) -> Result<String, SystemError> {
        let base_dir_var = "DASHQL_TEST_DATA";
        let base_dir = match env::var(base_dir_var) {
            Ok(p) => p,
            Err(_) => return Err(SystemError::MissingEnvironmentVariable(base_dir_var)),
        };
        let path_suffix = url.strip_prefix("test://").unwrap_or(url);
        let path_abs = Path::new(&base_dir).join(path_suffix);
        Ok(path_abs.to_string_lossy().to_string())
    }

    async fn import_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _info: &TaskState,
    ) -> Result<RuntimeDataHandle, SystemError> {
        todo!();
    }

    async fn load_data<'ast, 'snap>(
        &self,
        _ctx: &ExecutionContextSnapshot<'ast, 'snap>,
        _data: RuntimeDataHandle,
        _info: &TaskState,
    ) -> Result<(), SystemError> {
        todo!();
    }
}

pub fn create() -> Arc<dyn Runtime> {
    Arc::new(NativeRuntime {})
}
