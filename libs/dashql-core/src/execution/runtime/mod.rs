use std::sync::Arc;

mod dummy_runtime;
pub mod native_runtime;
mod runtime;
pub mod wasm_runtime;

pub use runtime::*;

pub fn create_default_runtime() -> Arc<dyn Runtime> {
    Arc::new(native_runtime::NativeRuntime {})
}
