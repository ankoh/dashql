use std::os::raw::c_char;

pub type ConnectionHdl = *const u8;
pub type BufferHdl = *const u8;

/// A packed response.
/// This is the "ugly" part of our WASM interop.
/// The fields error and data represent pointers that are 4 or 8 byte in length depending on the platform.
/// (32 bit on WASM vs 64 bit on Native)
#[repr(C)]
#[allow(dead_code)]
pub struct Response {
    pub status_code: u64,
    data_ptr: u64,
    data_size: u64,
}

#[allow(dead_code)]
impl Response {
    /// Get the error pointer
    pub fn error(&self) -> *const c_char {
        self.data_ptr as *const c_char
    }
    /// Get the data pointer
    pub fn value(&self) -> *const u8 {
        self.data_ptr as *const u8
    }

    /// Construct default value
    pub fn default() -> Self {
        Self {
            status_code: 0,
            data_ptr: 0,
            data_size: 0
        }
    }
}

#[allow(dead_code)]
extern "C" {
    /// Init the web api
    pub fn duckdb_webapi_init();
    /// Create a connection
    pub fn duckdb_webapi_connect() -> ConnectionHdl;
    /// Close a connection
    pub fn duckdb_webapi_disconnect(conn: ConnectionHdl);
    /// Register a buffer
    pub fn duckdb_webapi_register_buffer(
        conn: ConnectionHdl,
        buffer_ptr: *const u8,
        buffer_length: u32,
    );
    /// Release a buffer
    pub fn duckdb_webapi_release_buffer(conn: ConnectionHdl, buffer: BufferHdl);
    /// Access a buffer
    pub fn duckdb_webapi_access_buffer(conn: ConnectionHdl, buffer: BufferHdl) -> *const u8;
    /// Run a query
    pub fn duckdb_webapi_run_query(
        response: *mut Response,
        conn: ConnectionHdl,
        text: *const c_char,
    );
    /// Send a query
    pub fn duckdb_webapi_send_query(
        response: *mut Response,
        conn: ConnectionHdl,
        text: *const c_char,
    );
    /// Fetch query results
    pub fn duckdb_webapi_fetch_query_results(response: *mut Response, conn: ConnectionHdl);
    /// Analyze a query
    pub fn duckdb_webapi_analyze_query(
        response: *mut Response,
        conn: ConnectionHdl,
        text: *const c_char,
    );
    /// Analyze a query
    pub fn duckdb_webapi_generate_table(
        response: *mut Response,
        conn: ConnectionHdl,
        spec_handle: *const u8,
        spec_length: u32,
    );
}
