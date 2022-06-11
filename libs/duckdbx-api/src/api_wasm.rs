use crate::arrow_ipc::read_arrow_ipc_buffer;
use crate::backend::{DatabaseClient, DatabaseConnection, DatabaseInstance};
use async_trait::async_trait;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

pub fn main() {
    console_error_panic_hook::set_once();
}

pub fn configure() -> Box<dyn DatabaseClient> {
    Box::new(WasmDatabaseClient {})
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch)]
    async fn duckdbx_open(path: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn duckdbx_close(db: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(catch)]
    async fn duckdbx_connect(db: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(catch)]
    async fn duckdbx_disconnect(conn: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(catch)]
    async fn duckdbx_run_query(conn: JsValue, text: &str) -> Result<JsValue, JsValue>;
}

pub struct WasmDatabaseClient {}

#[async_trait(?Send)]
impl DatabaseClient for WasmDatabaseBackend {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseInstance>, String> {
        let result = duckdbx_open(JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(Box::new(WasmDatabaseInstance { inner: result }))
    }
}

pub struct WasmDatabaseInstance {
    inner: JsValue,
}

#[async_trait(?Send)]
impl DatabaseInstance for WasmDatabaseInstance {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String> {
        let result = duckdbx_connect(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(Box::new(WasmDatabaseConnection { inner: result }))
    }
}

pub struct WasmDatabaseConnection {
    inner: JsValue,
}

#[async_trait(?Send)]
impl DatabaseConnection for WasmDatabaseConnection {
    async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let result = duckdbx_run_query(self.inner.clone(), text)
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        let buffer: Uint8Array = result.into();
        let buffer_copied = buffer.to_vec();
        read_arrow_ipc_buffer(&buffer_copied)
    }
}
