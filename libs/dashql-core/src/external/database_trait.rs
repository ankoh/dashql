use std::sync::{Arc, Mutex};

use async_trait::async_trait;

use crate::error::SystemError;

#[async_trait(?Send)]
pub trait Database: std::fmt::Debug {
    async fn close(&mut self) -> Result<(), SystemError>;
    async fn connect(&mut self) -> Result<Arc<Mutex<dyn DatabaseConnection>>, SystemError>;
}

#[async_trait(?Send)]
pub trait DatabaseConnection: std::fmt::Debug {
    async fn close(&mut self) -> Result<(), SystemError>;
    async fn run_query(&mut self, text: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, SystemError>;
}
