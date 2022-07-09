use crate::{error::SystemError, utils::arrow_ipc::read_arrow_ipc_buffer};
use duckdbx_sys;

pub struct Database {
    inner: duckdbx_sys::Database,
}

impl Database {
    pub async fn open_in_memory() -> Result<Database, SystemError> {
        let db = duckdbx_sys::Database::open_in_memory().map_err(|err| SystemError::Generic(err))?;
        Ok(Database { inner: db })
    }
    pub async fn connect(&self) -> Result<DatabaseConnection, SystemError> {
        let conn = self.inner.connect().map_err(|err| SystemError::Generic(err))?;
        Ok(DatabaseConnection { inner: conn })
    }
    pub async fn close(&mut self) -> Result<(), String> {
        self.inner.close();
        Ok(())
    }
}

pub struct DatabaseConnection {
    inner: duckdbx_sys::Connection,
}

impl DatabaseConnection {
    pub async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError> {
        let buffer = self.inner.run_query(text)?;
        read_arrow_ipc_buffer(buffer.access())
    }
    pub async fn close(&mut self) -> Result<(), String> {
        self.inner.close();
        Ok(())
    }
}

impl std::fmt::Debug for Database {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Database").finish()
    }
}

impl std::fmt::Debug for DatabaseConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseConnection").finish()
    }
}

impl Drop for Database {
    fn drop(&mut self) {
        self.inner.close();
    }
}

impl Drop for DatabaseConnection {
    fn drop(&mut self) {
        self.inner.close();
    }
}
