use crate::utils::arrow_ipc::read_arrow_ipc_buffer;
use js_sys::Uint8Array;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/src/external/wasm/wasm_database.mjs")]
extern "C" {
    #[wasm_bindgen(js_name = "createClient", catch)]
    pub(crate) async fn js_create_client() -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "openDatabase", catch)]
    pub(crate) async fn js_open(client: JsValue, path: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "closeDatabase", catch)]
    pub(crate) async fn js_close(db: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = "createConnection", catch)]
    pub(crate) async fn js_create_connection(db: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "closeConnection", catch)]
    pub(crate) async fn js_close_connection(conn: JsValue) -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = "runQuery", catch)]
    pub(crate) async fn js_run_query(conn: JsValue, text: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "accessBuffer", catch)]
    pub(crate) fn js_access_buffer(buffer: JsValue) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_name = "deleteBuffer", catch)]
    pub(crate) fn js_delete_buffer(buffer: JsValue) -> Result<(), JsValue>;
}

pub struct DatabaseClient {
    inner: JsValue,
}

impl DatabaseClient {
    pub async fn create() -> Result<Self, String> {
        let result = js_create_client()
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseClient { inner: result })
    }
    pub async fn open_in_memory(&self) -> Result<DatabaseInstance, String> {
        let result = js_open(self.inner.clone(), JsValue::null())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseInstance { inner: result })
    }
}

pub struct DatabaseInstance {
    inner: JsValue,
}

impl DatabaseInstance {
    pub async fn close(&self) -> Result<(), String> {
        js_close(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(())
    }
    pub async fn connect(&self) -> Result<DatabaseConnection, String> {
        let result = js_create_connection(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(DatabaseConnection { inner: result })
    }
}

pub struct DatabaseConnection {
    inner: JsValue,
}

impl DatabaseConnection {
    pub async fn close(&self) -> Result<(), String> {
        js_close_connection(self.inner.clone())
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        Ok(())
    }
    pub async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let result = js_run_query(self.inner.clone(), text)
            .await
            .map_err(|e| e.as_string().unwrap_or_default())?;
        let buffer = js_access_buffer(result.clone()).map_err(|e| e.as_string().unwrap_or_default())?;
        let owned = Uint8Array::from(buffer.clone()).to_vec();
        js_delete_buffer(result).map_err(|e| e.as_string().unwrap_or_default())?;
        read_arrow_ipc_buffer(&owned)
    }
}

impl std::fmt::Debug for DatabaseClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseClient").finish()
    }
}
impl std::fmt::Debug for DatabaseInstance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseInstance").finish()
    }
}
impl std::fmt::Debug for DatabaseConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseConnection").finish()
    }
}