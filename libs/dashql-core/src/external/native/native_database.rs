use crate::utils::arrow_ipc::read_arrow_ipc_buffer;
use duckdbx_sys;

pub struct DatabaseClient {}

impl DatabaseClient {
    pub async fn create() -> Result<Self, String> {
        Ok(Self {})
    }
    pub async fn open_in_memory(&self) -> Result<DatabaseInstance, String> {
        duckdbx_sys::Database::open_in_memory().map(|db| DatabaseInstance { inner: db })
    }
}

impl std::fmt::Debug for DatabaseClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseClient").finish()
    }
}

pub struct DatabaseInstance {
    inner: duckdbx_sys::Database,
}

impl DatabaseInstance {
    pub async fn connect(&self) -> Result<DatabaseConnection, String> {
        self.inner.connect().map(|conn| DatabaseConnection { inner: conn })
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
    pub async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let buffer = self.inner.run_query(text)?;
        read_arrow_ipc_buffer(buffer.access())
    }
    pub async fn close(&mut self) -> Result<(), String> {
        self.inner.close();
        Ok(())
    }
}

impl std::fmt::Debug for DatabaseInstance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseInstance").finish()
    }
}

impl Drop for DatabaseInstance {
    fn drop(&mut self) {
        self.inner.close();
    }
}

impl Drop for DatabaseConnection {
    fn drop(&mut self) {
        self.inner.close();
    }
}
