use crate::error::SystemError;

use super::Runtime;

#[derive(Debug)]
pub struct PanicRuntime {}

impl Runtime for PanicRuntime {
    fn import_data(&self) -> Result<super::RuntimeDataHandle, SystemError> {
        panic!("importing data not implemented")
    }
}
