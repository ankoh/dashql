use std::sync::Arc;

pub mod native_runtime;
pub mod panic_runtime;
mod runtime;
pub mod web_runtime;

pub use runtime::*;

pub fn create_default_runtime() -> Arc<dyn Runtime> {
    Arc::new(panic_runtime::PanicRuntime {})
}
