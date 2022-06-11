use duckdb;

#[test]
pub fn hello_duckdb() {
    duckdb::Database::open_transient();
}
