pub mod wasm_database;
pub mod wasm_parser;
pub mod wasm_runtime;

pub use wasm_database as database;
pub use wasm_parser as parser;
pub use wasm_runtime as runtime;

use std::sync::Arc;

pub fn create_runtime() -> Arc<dyn Runtime> {
    Arc::new(wasm_runtime::WasmRuntime {})
}
