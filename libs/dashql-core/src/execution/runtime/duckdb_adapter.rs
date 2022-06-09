use libc::{c_char, c_void, size_t};

#[repr(usize)]
pub enum DuckDBResult {
    Success = 0,
    Error = 1,
}

pub type DuckdbResult = *const c_void;
pub type DuckdbDatabase = *const c_void;
pub type DuckdbConnection = *const c_void;
pub type DuckdbLogicalType = *const c_void;

extern "C" {
    pub fn duckdb_open(path: *const c_char, out_database: *mut DuckdbDatabase) -> DuckDBResult;
    pub fn duckdb_close(database: DuckdbDatabase);
    pub fn duckdb_connect(database: DuckdbDatabase, out_connection: *mut DuckdbConnection) -> DuckDBResult;
    pub fn duckdb_disconnect(connection: DuckdbConnection);

    pub fn duckdb_query(connection: DuckdbConnection, query: *const c_char, out_result: DuckDBResult) -> DuckDBResult;
    pub fn duckdb_destroy_result(result: DuckDBResult);

    pub fn duckdb_column_count(result: DuckDBResult) -> size_t;
    pub fn duckdb_column_name(result: DuckDBResult, col: size_t) -> *const c_char;
    pub fn duckdb_column_logical_type(result: DuckDBResult, col: size_t) -> size_t;

    pub fn duckdb_value_boolean(result: DuckDBResult, col: size_t, row: size_t) -> bool;
    pub fn duckdb_value_int8(result: DuckDBResult, col: size_t, row: size_t) -> i8;
    pub fn duckdb_value_int16(result: DuckDBResult, col: size_t, row: size_t) -> i16;
    pub fn duckdb_value_int32(result: DuckDBResult, col: size_t, row: size_t) -> i32;
    pub fn duckdb_value_int64(result: DuckDBResult, col: size_t, row: size_t) -> i64;
}
