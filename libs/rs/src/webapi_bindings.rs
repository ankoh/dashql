use crate::error::Error;
use std::ffi::CStr;
use std::os::raw::c_char;

pub type ConnectionHdl = usize;
pub type BufferHdl = usize;

/// A packed response.
/// This is the "ugly" part of our WASM interop.
/// The data pointer is either 4 or 8 byte in length depending on the platform.
/// (32 bit on WASM vs 64 bit on Native)
/// We always pack it as 64 bit integer.
#[repr(C)]
#[allow(dead_code)]
pub struct Response {
    pub status_code: u64,
    data_ptr: u64,
    data_size: u64,
}

#[allow(dead_code)]
impl Response {
    /// Read error string
    pub fn as_error(&self) -> Result<String, Error> {
        unsafe {
            let b = std::slice::from_raw_parts(self.data_ptr as *mut u8, self.data_size as usize);
            let cs = match CStr::from_bytes_with_nul(b) {
                Ok(cs) => cs,
                Err(_) => return Err(Error::InvalidStringData)
            };
            let s = match cs.to_str() {
                Ok(s) => s,
                Err(_) => return Err(Error::InvalidStringData)
            };
            Ok(String::from(s))
        }
    }

    /// Get the value buffer handle
    pub fn as_buffer(&self) -> (BufferHdl, usize) {
        (self.data_ptr as BufferHdl, self.data_size as usize)
    }

    /// Construct default value
    pub fn default() -> Self {
        Self {
            status_code: 0,
            data_ptr: 0,
            data_size: 0,
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
    pub fn duckdb_webapi_register_buffer(conn: ConnectionHdl, buffer_ptr: *const u8, buffer_length: u32);
    /// Release a buffer
    pub fn duckdb_webapi_release_buffer(conn: ConnectionHdl, buffer: BufferHdl);
    /// Access a buffer
    pub fn duckdb_webapi_access_buffer(conn: ConnectionHdl, buffer: BufferHdl) -> *const u8;
    /// Run a query
    pub fn duckdb_webapi_run_query(response: *mut Response, conn: ConnectionHdl, text: *const c_char);
    /// Send a query
    pub fn duckdb_webapi_send_query(response: *mut Response, conn: ConnectionHdl, text: *const c_char);
    /// Fetch query results
    pub fn duckdb_webapi_fetch_query_results(response: *mut Response, conn: ConnectionHdl);
    /// Analyze a query
    pub fn duckdb_webapi_analyze_query(response: *mut Response, conn: ConnectionHdl, text: *const c_char);
    /// Analyze a query
    pub fn duckdb_webapi_generate_table(
        response: *mut Response,
        conn: ConnectionHdl,
        spec_handle: *const u8,
        spec_length: u32,
    );
}
