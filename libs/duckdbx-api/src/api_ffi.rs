use crate::api::{DatabaseClient, DatabaseConnection, DatabaseInstance};
use crate::arrow_ipc::read_arrow_ipc_buffer;
use async_trait::async_trait;
use duckdbx;

pub fn configure() -> Box<dyn DatabaseClient> {
    Box::new(FFIDatabaseClient {})
}

pub struct FFIDatabaseClient {}

#[async_trait(?Send)]
impl DatabaseClient for FFIDatabaseClient {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseInstance>, String> {
        duckdbx::Database::open_transient()
            .map(|db| Box::new(FFIDatabaseInstance { inner: db }) as Box<dyn DatabaseInstance>)
    }
}

pub struct FFIDatabaseInstance {
    inner: duckdbx::Database,
}

#[async_trait(?Send)]
impl DatabaseInstance for FFIDatabaseInstance {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String> {
        self.inner
            .connect()
            .map(|conn| Box::new(FFIDatabaseConnection { inner: conn }) as Box<dyn DatabaseConnection>)
    }
}

pub struct FFIDatabaseConnection {
    inner: duckdbx::Connection,
}

#[async_trait(?Send)]
impl DatabaseConnection for FFIDatabaseConnection {
    async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let buffer = self.inner.run_query(text)?;
        read_arrow_ipc_buffer(buffer.get())
    }
}
