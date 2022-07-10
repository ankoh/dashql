use super::super::database_trait::{Database, DatabaseConnection};
use super::duckdb_wasm_bindings::{AsyncDuckDB, AsyncDuckDBConnection, JsAsyncDuckDB};
use crate::error::SystemError;
use crate::external::QueryResultBuffer;
use crate::utils::arrow_ipc::read_arrow_ipc_buffer;
use async_trait::async_trait;
use js_sys::Uint8Array;
use std::cell::RefCell;
use std::sync::{Arc, Mutex};
use wasm_bindgen::prelude::*;

thread_local! {
    static DUCKDB: RefCell<Option<Arc<AsyncDuckDB>>> = RefCell::new(None);
}

#[wasm_bindgen(js_name = "linkDuckDB")]
pub fn link_duckdb(db: JsAsyncDuckDB) {
    DUCKDB.with(|linked| linked.replace(Some(Arc::new(AsyncDuckDB::from_bindings(db)))));
}

pub struct WasmDatabase {
    db: Arc<AsyncDuckDB>,
}

fn map_result<T>(result: Result<T, js_sys::Error>) -> Result<T, SystemError> {
    result.map_err(|e| SystemError::Generic(e.message().to_string().as_string().unwrap_or_default()))
}

impl WasmDatabase {
    pub async fn open_in_memory() -> Result<Self, SystemError> {
        let db = DUCKDB.with(|db| db.borrow().clone());
        let db = match db {
            Some(db) => db,
            None => return Err(SystemError::Generic("duckdb not linked".to_string())),
        };
        map_result(db.open(None).await)?;
        Ok(WasmDatabase { db })
    }
}

#[async_trait(?Send)]
impl Database for WasmDatabase {
    async fn close(&mut self) -> Result<(), SystemError> {
        Ok(())
    }
    async fn connect(&mut self) -> Result<Arc<Mutex<dyn DatabaseConnection>>, SystemError> {
        let conn = map_result(self.db.connect().await)?;
        let conn = Arc::new(conn);
        Ok(Arc::new(Mutex::new(WasmDatabaseConnection { conn })))
    }
}

impl std::fmt::Debug for WasmDatabase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

pub struct WasmDatabaseConnection {
    conn: Arc<AsyncDuckDBConnection>,
}

#[async_trait(?Send)]
impl DatabaseConnection for WasmDatabaseConnection {
    async fn close(&mut self) -> Result<(), SystemError> {
        map_result(self.conn.disconnect().await)
    }
    async fn run_query(&mut self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        let buffer = map_result(self.conn.run_query(text).await)?;
        Ok(Arc::new(WasmQueryResultBuffer { buffer }))
    }
}
impl std::fmt::Debug for WasmDatabaseConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseConnection").finish()
    }
}

pub struct WasmQueryResultBuffer {
    buffer: Uint8Array,
}

impl QueryResultBuffer for WasmQueryResultBuffer {
    fn read_arrow_batches(&self) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError> {
        let copy = self.buffer.to_vec();
        read_arrow_ipc_buffer(&copy)
    }
    #[cfg(all(feature = "wasm", not(feature = "native")))]
    fn read_data_handle<'a>(&'a self) -> &'a Uint8Array {
        &self.buffer
    }
}
