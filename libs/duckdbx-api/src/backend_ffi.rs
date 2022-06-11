use crate::backend::{DatabaseBackend, DatabaseClient, DatabaseConnection};
use async_trait::async_trait;

pub struct FFIDatabaseBackend {}

pub struct FFIDatabaseClient {}

pub struct FFIDatabaseConnection {}

#[async_trait(?Send)]
impl DatabaseBackend for FFIDatabaseBackend {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseClient>, String> {
        todo!()
    }
}

#[async_trait(?Send)]
impl DatabaseClient for FFIDatabaseClient {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String> {
        todo!()
    }
}

#[async_trait(?Send)]
impl DatabaseConnection for FFIDatabaseConnection {
    async fn run_query(&self, _text: &str) -> Result<Box<dyn crate::backend::Buffer>, String> {
        todo!()
    }
}
