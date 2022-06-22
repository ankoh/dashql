use crate::api::{DatabaseClient, DatabaseConnection, DatabaseInstance};
use crate::arrow_ipc::read_arrow_ipc_buffer;
use async_trait::async_trait;
use js_sys::Uint8Array;
use std::sync::Arc;
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

pub struct DatabaseClient {
    inner: JsValue,
}

impl std::fmt::Debug for DatabaseClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseClient").finish()
    }
}

impl DatabaseClient {
    pub async fn create() -> Result<Self, String> {
        let result = duckdbx_configure()
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseClient { inner: result })
    }
    pub async fn open_transient(&self) -> Result<DatabaseInstance, String> {
        let result = duckdbx_open(self.inner.clone(), JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(Box::new(DatabaseInstance { inner: result }))
    }
}

pub struct DatabaseInstance {
    inner: JsValue,
}

impl DatabaseInstance {
    pub async fn connect(&self) -> Result<DatabaseConnection, String> {
        let result = duckdbx_connect(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(Box::new(DatabaseConnection { inner: result }))
    }
}

pub struct DatabaseConnection {
    inner: JsValue,
}

impl DatabaseConnection {
    pub async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let result = duckdbx_run_query(self.inner.clone(), text)
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        let buffer: Uint8Array = result.into();
        let buffer_copied = buffer.to_vec();
        read_arrow_ipc_buffer(&buffer_copied)
    }
}
