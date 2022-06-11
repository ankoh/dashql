use duckdbx;
use std::error::Error;

#[test]
pub fn hello_duckdb() -> Result<(), Box<dyn Error + Send + Sync>> {
    let db = duckdbx::Database::open_transient()?;
    let conn = db.connect()?;
    let result_ipc = conn.run_query("select 1;")?;
    let result = duckdbx::read_arrow_ipc_buffer(&result_ipc)?;
    assert_eq!(result.len(), 1);
    Ok(())
}
