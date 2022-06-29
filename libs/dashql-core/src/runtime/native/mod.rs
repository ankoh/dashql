pub mod native_runtime;

use crate::runtime::Runtime;
use std::sync::Arc;

pub fn create_runtime() -> Arc<dyn Runtime> {
    Arc::new(native_runtime::NativeRuntime {})
}
