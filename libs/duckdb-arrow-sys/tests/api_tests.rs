use duckdb;
use std::error::Error;

#[test]
pub fn hello_duckdb() -> Result<(), Box<dyn Error + Send + Sync>> {
    let db = duckdb::Database::open_transient()?;
    let conn = db.connect()?;
    let result = conn.run_query("select 1;")?;
    assert_eq!(result.len(), 1);
    Ok(())
}