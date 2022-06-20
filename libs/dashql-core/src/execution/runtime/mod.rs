use std::sync::Arc;

pub mod native_runtime;
mod placeholder_runtime;
mod runtime;
pub mod web_runtime;

pub use runtime::*;

pub fn create_default_runtime() -> Arc<dyn Runtime> {
    Arc::new(placeholder_runtime::PlaceholderRuntime {})
}
