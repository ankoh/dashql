pub mod wasm_duckdb_bindings;
pub mod wasm_runtime;

use std::sync::Arc;

pub fn create_runtime() -> Arc<dyn Runtime> {
    Arc::new(wasm_runtime::WasmRuntime {})
}
