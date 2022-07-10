use std::sync::{Arc, Mutex};

use super::super::database_trait::{Database, DatabaseConnection};
use crate::{error::SystemError, external::QueryResultBuffer, utils::arrow_ipc::read_arrow_ipc_buffer};
use async_trait::async_trait;
use duckdbx_sys;

pub struct NativeDatabase {
    inner: duckdbx_sys::Database,
}

impl NativeDatabase {
    pub async fn open_in_memory() -> Result<NativeDatabase, SystemError> {
        let db = duckdbx_sys::Database::open_in_memory().map_err(|err| SystemError::Generic(err))?;
        Ok(NativeDatabase { inner: db })
    }
}

#[async_trait(?Send)]
impl Database for NativeDatabase {
    async fn close(&mut self) -> Result<(), SystemError> {
        self.inner.close();
        Ok(())
    }
    async fn connect(&mut self) -> Result<Arc<Mutex<dyn DatabaseConnection>>, SystemError> {
        let conn = self.inner.connect().map_err(|err| SystemError::Generic(err))?;
        Ok(Arc::new(Mutex::new(NativeDatabaseConnection { inner: conn })))
    }
}

impl std::fmt::Debug for NativeDatabase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

impl Drop for NativeDatabase {
    fn drop(&mut self) {
        self.inner.close();
    }
}

pub struct NativeDatabaseConnection {
    inner: duckdbx_sys::Connection,
}

#[async_trait(?Send)]
impl DatabaseConnection for NativeDatabaseConnection {
    async fn close(&mut self) -> Result<(), SystemError> {
        self.inner.close();
        Ok(())
    }
    async fn run_query(&mut self, text: &str) -> Result<Arc<dyn QueryResultBuffer>, SystemError> {
        let buffer = self.inner.run_query(text)?;
        Ok(Arc::new(NativeQueryResultBuffer { buffer }))
    }
}

impl std::fmt::Debug for NativeDatabaseConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseConnection").finish()
    }
}

impl Drop for NativeDatabaseConnection {
    fn drop(&mut self) {
        self.inner.close();
    }
}

pub struct NativeQueryResultBuffer {
    buffer: duckdbx_sys::Buffer,
}

impl QueryResultBuffer for NativeQueryResultBuffer {
    fn read_arrow_batches(&self) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError> {
        let copy = self.buffer.access();
        read_arrow_ipc_buffer(copy)
    }
    #[cfg(all(feature = "native", not(feature = "wasm")))]
    fn read_data_handle<'a>(&'a self) -> &'a duckdbx_sys::Buffer {
        &self.buffer
    }
}
