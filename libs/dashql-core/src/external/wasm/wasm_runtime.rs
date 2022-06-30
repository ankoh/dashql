use std::sync::Arc;

pub fn create() -> Arc<dyn Runtime> {
    Arc::new(wasm_runtime::WasmRuntime {})
}
