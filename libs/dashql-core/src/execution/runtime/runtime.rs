use async_trait::async_trait;

use crate::error::SystemError;

pub type RuntimeDataHandle = u64;

#[async_trait(?Send)]
pub trait Runtime: std::fmt::Debug {
    fn import_data(&self) -> Result<RuntimeDataHandle, SystemError>;
}
