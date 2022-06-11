use async_trait::async_trait;

#[async_trait(?Send)]
pub trait DatabaseClient {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseInstance>, String>;
}

#[async_trait(?Send)]
pub trait DatabaseInstance {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String>;
}

#[async_trait(?Send)]
pub trait DatabaseConnection {
    async fn run_query(&self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String>;
}
