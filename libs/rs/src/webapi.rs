use std::os::raw::c_char;
use crate::webapi_bindings::{
    BufferHdl,
    ConnectionHdl,
    Response,
    duckdb_webapi_access_buffer,
    duckdb_webapi_analyze_query,
    duckdb_webapi_disconnect,
    duckdb_webapi_fetch_query_results,
    duckdb_webapi_init,
    duckdb_webapi_register_buffer,
    duckdb_webapi_release_buffer,
    duckdb_webapi_run_query,
    duckdb_webapi_send_query,
};

pub struct Buffer<'conn> {
    connection: &'conn Connection,
    data_handle: BufferHdl,
    data_size: usize,
    data_ptr: *const u8,
}

impl<'conn> Buffer<'conn> {
    /// Access a buffer
    pub fn access<'buffer>(&'buffer mut self) -> &'buffer [u8] {
        unsafe {
            if self.data_ptr.is_null() {
                return std::slice::from_raw_parts(self.data_ptr, self.data_size);
            } else {
                self.data_ptr = self.connection.access_buffer(self.data_handle);
                return std::slice::from_raw_parts(self.data_ptr, self.data_size);
            }
        }
    }
}

impl<'conn> Drop for Buffer<'conn> {
    /// Drop a buffer
    fn drop(&mut self) {
        self.connection.release_buffer(self.data_handle);
    }
}

pub struct Connection {
    conn: ConnectionHdl,
}

#[allow(dead_code)]
impl Connection {
    /// Disconnect
    pub fn disconnect(&self) -> Result<(), ()> {
        unsafe {
            duckdb_webapi_disconnect(self.conn);
        }
        Ok(())
    }

    /// Access a buffer
    pub fn access_buffer(&self, buffer: BufferHdl) -> *const u8 {
        unsafe {
            return duckdb_webapi_access_buffer(self.conn, buffer);
        }
    }

    /// Register a buffer
    pub fn register_buffer(&self, buffer_ptr: *const u8, buffer_length: u32) {
        unsafe {
            duckdb_webapi_register_buffer(self.conn, buffer_ptr, buffer_length);
        }
    }

    /// Release a buffer
    pub fn release_buffer(&self, buffer: BufferHdl) {
        unsafe {
            duckdb_webapi_release_buffer(self.conn, buffer);
        }
    }

    /// Run a query
    pub fn run_query(&self, text: *const c_char) {
        let mut response = Response::default();
        unsafe {
            duckdb_webapi_run_query(&mut response, self.conn, text);
        }
    }

    /// Send a query
    pub fn send_query(&self, text: *const c_char) {
        let mut response = Response::default();
        unsafe {
            duckdb_webapi_send_query(&mut response, self.conn, text);
        }
    }

    /// Fetch query results
    pub fn fetch_query_results(&self) {
        let mut response = Response::default();
        unsafe {
            duckdb_webapi_fetch_query_results(&mut response, self.conn);
        }
    }

    /// Analyze query
    pub fn analyze_query(&self, text: *const c_char) {
        let mut response = Response::default();
        unsafe {
            duckdb_webapi_analyze_query(&mut response, self.conn, text);
        }
    }
}

pub struct WebAPI {
}

#[allow(dead_code)]
impl WebAPI {
    /// Init webapi
    pub fn init() {
        unsafe {
            duckdb_webapi_init()
        }
    }

    /// Connect
    pub fn connect() -> Result<Connection, ()> {
        Err(())
    }
}
