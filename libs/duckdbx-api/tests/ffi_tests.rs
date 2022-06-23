#![cfg(feature = "native")]

use duckdbx_api;
use std::error::Error;

#[tokio::test]
pub async fn hello_duckdb() -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = duckdbx_api::DatabaseClient::create().await?;
    let db = client.open_transient().await?;
    let conn = db.connect().await?;
    let result = conn.run_query("select 1;").await?;
    assert_eq!(result.len(), 1);
    Ok(())
}
