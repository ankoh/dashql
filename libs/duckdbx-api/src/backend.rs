use async_trait::async_trait;

#[async_trait(?Send)]
pub trait DatabaseBackend {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseClient>, String>;
}

#[async_trait(?Send)]
pub trait DatabaseClient {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String>;
}

pub trait Buffer {
    fn get<'a>(&'a self) -> &'a [u8];
}

#[async_trait(?Send)]
pub trait DatabaseConnection {
    async fn run_query(&self, text: &str) -> Result<Box<dyn Buffer>, String>;
}
