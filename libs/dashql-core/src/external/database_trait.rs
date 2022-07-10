use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::error::SystemError;

pub trait QueryResultBuffer {
    fn read_arrow_batches(&self) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError>;

    // Raw passthrough of the duckdbx buffer
    #[cfg(feature = "native")]
    fn read_native_data_handle<'a>(&'a self) -> &'a duckdbx_sys::Buffer;
    // Raw passthrough of the uint8array
    #[cfg(feature = "wasm")]
    fn read_wasm_data_handle<'a>(&'a self) -> &'a js_sys::Uint8Array;
}

#[async_trait(?Send)]
pub trait Database: std::fmt::Debug {
    async fn close(&mut self) -> Result<(), SystemError>;
    async fn connect(&mut self) -> Result<Arc<Mutex<dyn DatabaseConnection>>, SystemError>;
}

#[async_trait(?Send)]
pub trait DatabaseConnection: std::fmt::Debug {
    async fn close(&mut self) -> Result<(), SystemError>;
    async fn run_query(&mut self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError>;
}
