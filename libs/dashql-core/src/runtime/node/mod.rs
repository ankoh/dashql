pub mod node_duckdb_bindings;
pub mod node_runtime;

use std::sync::Arc;

pub fn create_runtime() -> Arc<dyn Runtime> {
    Arc::new(node_runtime::NativeRuntime {})
}
