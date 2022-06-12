use crate::api::{DatabaseClient, DatabaseConnection, DatabaseInstance};
use crate::arrow_ipc::read_arrow_ipc_buffer;
use async_trait::async_trait;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/js/bindings.mjs")]
extern "C" {
    #[wasm_bindgen(js_name = "configure", catch)]
    async fn duckdbx_configure() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "open", catch)]
    async fn duckdbx_open(client: JsValue, path: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "close", catch)]
    async fn duckdbx_close(db: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = "connect", catch)]
    async fn duckdbx_connect(db: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "disconnect", catch)]
    async fn duckdbx_disconnect(conn: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = "runQuery", catch)]
    async fn duckdbx_run_query(conn: JsValue, text: &str) -> Result<JsValue, JsValue>;
}

pub async fn configure() -> Result<Box<dyn DatabaseClient>, String> {
    let result = duckdbx_configure()
        .await
        .map_err(|e| e.as_string().unwrap_or_default())?;
    Ok(Box::new(WasmDatabaseClient { inner: result }))
}

pub struct WasmDatabaseClient {
    inner: JsValue,
}

#[async_trait(?Send)]
impl DatabaseClient for WasmDatabaseClient {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseInstance>, String> {
        let result = duckdbx_open(self.inner.clone(), JsValue::null())
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
