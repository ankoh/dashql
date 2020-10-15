extern crate duckdb_webapi;
use std::ffi::CString;

use duckdb_webapi::DuckDB;

#[test]
fn test_connect() -> Result<(), duckdb_webapi::error::Error> {
    DuckDB::init();

    let conn = DuckDB::connect()?;
    let mut result = conn.send_query(CString::new("select 1")?.as_c_str())?;
    let _result_table = result.access();
    let _chunk = conn.fetch_query_results()?;

    Ok(())
}

