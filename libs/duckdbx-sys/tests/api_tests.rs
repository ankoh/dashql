use duckdbx;
use std::error::Error;

#[test]
pub fn hello_duckdb() -> Result<(), Box<dyn Error + Send + Sync>> {
    let db = duckdbx::Database::open_transient()?;
    let conn = db.connect()?;
    let result = conn.run_query_and_unpack("select 1;")?;
    assert_eq!(result.len(), 1);
    Ok(())
}
