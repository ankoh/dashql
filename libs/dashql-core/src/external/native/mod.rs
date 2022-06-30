pub mod native_database;
pub mod native_parser;
pub mod native_runtime;

pub use native_database as database;
pub use native_parser as parser;
pub use native_runtime as runtime;

use crate::external::Runtime;
use std::sync::Arc;

pub fn create_runtime() -> Arc<dyn Runtime> {
    Arc::new(native_runtime::NativeRuntime {})
}
