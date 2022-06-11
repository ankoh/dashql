use crate::backend::{Buffer, DatabaseBackend, DatabaseClient, DatabaseConnection};
use async_trait::async_trait;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

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

pub struct WasmDatabaseBackend {}

#[async_trait(?Send)]
impl DatabaseBackend for WasmDatabaseBackend {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseClient>, String> {
        let result = duckdbx_open(JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(Box::new(WasmDatabaseClient { inner: result }))
    }
}

pub struct WasmDatabaseClient {
    inner: JsValue,
}

#[async_trait(?Send)]
impl DatabaseClient for WasmDatabaseClient {
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
    async fn run_query(&self, text: &str) -> Result<Box<dyn crate::backend::Buffer>, String> {
        let result = duckdbx_run_query(self.inner.clone(), text)
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        let buffer: Uint8Array = result.into();
        Ok(Box::new(Uint8ArrayBuffer {
            buffer: buffer.to_vec(),
        }))
    }
}

pub struct Uint8ArrayBuffer {
    buffer: Vec<u8>,
}

impl Buffer for Uint8ArrayBuffer {
    fn get<'a>(&'a self) -> &'a [u8] {
        self.buffer.as_slice()
    }
}
