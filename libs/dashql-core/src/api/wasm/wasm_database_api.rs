use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

use crate::external::wasm::wasm_database::{
    js_close, js_close_connection, js_create_client, js_create_connection, js_open, js_run_query,
};

#[wasm_bindgen]
pub struct DatabaseClient {
    inner: JsValue,
}

#[wasm_bindgen]
impl DatabaseClient {
    pub async fn create() -> Result<DatabaseClient, String> {
        let result = js_create_client()
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseClient { inner: result })
    }
    pub async fn open_in_memory(self) -> Result<DatabaseInstance, String> {
        let result = js_open(self.inner.clone(), JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseInstance { inner: result })
    }
}

#[wasm_bindgen]
pub struct DatabaseInstance {
    inner: JsValue,
}

#[wasm_bindgen]
impl DatabaseInstance {
    pub async fn close(self) -> Result<(), String> {
        js_close(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(())
    }
    pub async fn connect(self) -> Result<DatabaseConnection, String> {
        let result = js_create_connection(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseConnection { inner: result })
    }
}

#[wasm_bindgen]
pub struct DatabaseConnection {
    inner: JsValue,
}

#[wasm_bindgen]
impl DatabaseConnection {
    pub async fn close(self) -> Result<(), String> {
        js_close_connection(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(())
    }
    pub async fn run_query(self, text: String) -> Result<Uint8Array, String> {
        let result = js_run_query(self.inner.clone(), &text)
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        let array: Uint8Array = result.into();
        Ok(array)
    }
}
