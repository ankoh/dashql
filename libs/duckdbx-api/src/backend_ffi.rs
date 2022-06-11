use crate::backend::{DatabaseBackend, DatabaseClient, DatabaseConnection};
use async_trait::async_trait;
use duckdbx;

pub struct FFIDatabaseBackend {}

#[async_trait(?Send)]
impl DatabaseBackend for FFIDatabaseBackend {
    async fn open_transient(&self) -> Result<Box<dyn DatabaseClient>, String> {
        todo!()
    }
}

pub struct FFIDatabaseClient {
    inner: duckdbx::Database,
}

#[async_trait(?Send)]
impl DatabaseClient for FFIDatabaseClient {
    async fn connect(&self) -> Result<Box<dyn DatabaseConnection>, String> {
        todo!()
    }
}

pub struct FFIDatabaseConnection {
    inner: duckdbx::Connection,
}

#[async_trait(?Send)]
impl DatabaseConnection for FFIDatabaseConnection {
    async fn run_query(&self, _text: &str) -> Result<Box<dyn crate::backend::Buffer>, String> {
        todo!()
    }
}
