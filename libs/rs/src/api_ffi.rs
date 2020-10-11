use std::os::raw::c_char;

/// An opaque connection
#[repr(C)]
struct Connection {}

/// A packed response.
/// This is the "ugly" part of our WASM interop.
/// The fields error and data represent pointers that are 4 or 8 byte in length depending on the platform.
/// (32 bit on WASM vs 64 bit on Native)
#[repr(C)]
struct Response {
    status_code: u64,
    error_ptr: u64,
    data_ptr: u64,
    data_size: u64,
}

impl Response {
    /// Get the error pointer
    fn error(&self) -> *const c_char { self.error_ptr as *const c_char };
    /// Get the data pointer
    fn data(&self) -> *const u8 { self.data_ptr as *const u8 }
}

extern "C" {
    /// Creat a connection
    fn duckdb_webapi_connect() -> *const Connection;
    /// Close a connection
    fn duckdb_webapi_disconnect(conn: *const Connection) -> *const Connection;
    /// Register a buffer
    fn duckdb_webapi_register_buffer(
        conn: *const Connection,
        buffer_ptr: *const u8,
        buffer_length: u32,
    );
    /// Release a buffer
    fn duckdb_webapi_release_buffer(conn: *const Connection, buffer_ptr: *const u8);
    /// Run a query
    fn duckdb_webapi_run_query(
        response: *mut Response,
        conn: *const Connection,
        text: *const c_char,
    );
    /// Send a query
    fn duckdb_webapi_send_query(
        response: *mut Response,
        conn: *const Connection,
        text: *const c_char,
    );
    /// Fetch query results
    fn duckdb_webapi_fetch_query_results(response: *mut Response, conn: *const Connection);
    /// Analyze a query
    fn duckdb_webapi_analyze_query(
        response: *mut Response,
        conn: *const Connection,
        text: *const c_char,
    );
    /// Analyze a query
    fn duckdb_webapi_generate_table(
        response: *mut Response,
        conn: *const Connection,
        spec_ptr: *const u8,
        spec_length: u32,
    );
}
