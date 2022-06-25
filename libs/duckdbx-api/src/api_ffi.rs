use crate::arrow_ipc::read_arrow_ipc_buffer;
use duckdbx;

pub struct DatabaseClient {}

impl DatabaseClient {
    pub async fn create() -> Result<Self, String> {
        Ok(Self {})
    }
    pub async fn open_in_memory(&self) -> Result<DatabaseInstance, String> {
        duckdbx::Database::open_in_memory().map(|db| DatabaseInstance { inner: db })
    }
}

impl std::fmt::Debug for DatabaseClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseClient").finish()
    }
}

pub struct DatabaseInstance {
    inner: duckdbx::Database,
}

impl std::fmt::Debug for DatabaseInstance {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DatabaseInstance").finish()
    }
}

impl DatabaseInstance {
    pub async fn connect(&self) -> Result<DatabaseConnection, String> {
        self.inner.connect().map(|conn| DatabaseConnection { inner: conn })
    }
}

pub struct DatabaseConnection {
    inner: duckdbx::Connection,
}

impl DatabaseConnection {
    pub async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let buffer = self.inner.run_query(text)?;
        read_arrow_ipc_buffer(buffer.access())
    }
}
