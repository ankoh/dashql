use crate::arrow_ipc::read_arrow_ipc_buffer;
use async_trait::async_trait;
use js_sys::Uint8Array;
use std::sync::Arc;
use wasm_bindgen::prelude::*;

#[cfg_attr(feature = "browser", wasm_bindgen(module = "/js/browser_runtime.mjs"))]
#[cfg_attr(feature = "node", wasm_bindgen(module = "/js/node_runtime.mjs"))]
#[cfg_attr(feature = "node-ipc", wasm_bindgen(module = "/js/node_ipc_runtime.mjs"))]
extern "C" {
    #[wasm_bindgen(js_name = "createClient", catch)]
    async fn duckdbx_create_client() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "openDatabase", catch)]
    async fn duckdb_open_database(client: JsValue, path: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "closeDatabase", catch)]
    async fn duckdbx_close_database(db: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = "createConnection", catch)]
    async fn duckdb_create_connection(db: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "closeConnection", catch)]
    async fn duckdb_close_connection(conn: JsValue) -> Result<(), JsValue>;
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
        let result = duckdbx_create_client()
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseClient { inner: result })
    }
    pub async fn open_in_memory(&self) -> Result<DatabaseInstance, String> {
        let result = duckdb_open_database(self.inner.clone(), JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseInstance { inner: result })
    }
}

pub struct DatabaseInstance {
    inner: JsValue,
}

impl DatabaseInstance {
    pub async fn connect(&self) -> Result<DatabaseConnection, String> {
        let result = duckdb_create_connection(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseConnection { inner: result })
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
