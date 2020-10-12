use std::os::raw::c_char;

/// A packed response.
/// This is the "ugly" part of our WASM interop.
/// The fields error and data represent pointers that are 4 or 8 byte in length depending on the platform.
/// (32 bit on WASM vs 64 bit on Native)
#[repr(C)]
#[allow(dead_code)]
pub struct Response {
    status_code: u64,
    error_ptr: u64,
    data_ptr: u64,
    data_size: u64,
}

#[allow(dead_code)]
impl Response {
    /// Get the error pointer
    fn error(&self) -> *const c_char {
        self.error_ptr as *const c_char
    }
    /// Get the data pointer
    fn data(&self) -> *const u8 {
        self.data_ptr as *const u8
    }
}

#[allow(dead_code)]
extern "C" {
    /// Init the web api
    pub fn duckdb_webapi_init();
    /// Create a connection
    pub fn duckdb_webapi_connect() -> *const u8;
    /// Close a connection
    pub fn duckdb_webapi_disconnect(conn: *const u8);
    /// Register a buffer
    pub fn duckdb_webapi_register_buffer(
        conn: *const u8,
        buffer_ptr: *const u8,
        buffer_length: u32,
    );
    /// Release a buffer
    pub fn duckdb_webapi_release_buffer(conn: *const u8, buffer: *const u8);
    /// Run a query
    pub fn duckdb_webapi_run_query(
        response: *mut Response,
        conn: *const u8,
        text: *const c_char,
    );
    /// Send a query
    pub fn duckdb_webapi_send_query(
        response: *mut Response,
        conn: *const u8,
        text: *const c_char,
    );
    /// Fetch query results
    pub fn duckdb_webapi_fetch_query_results(response: *mut Response, conn: *const u8);
    /// Analyze a query
    pub fn duckdb_webapi_analyze_query(
        response: *mut Response,
        conn: *const u8,
        text: *const c_char,
    );
    /// Analyze a query
    pub fn duckdb_webapi_generate_table(
        response: *mut Response,
        conn: *const u8,
        spec_handle: *const u8,
        spec_length: u32,
    );
}
