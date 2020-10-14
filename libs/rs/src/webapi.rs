use crate::error::Error;
use crate::proto::{QueryResult, StatusCode};
use crate::webapi_bindings::{
    duckdb_webapi_access_buffer, duckdb_webapi_analyze_query, duckdb_webapi_disconnect,
    duckdb_webapi_fetch_query_results, duckdb_webapi_init, duckdb_webapi_register_buffer, duckdb_webapi_release_buffer,
    duckdb_webapi_run_query, duckdb_webapi_send_query, BufferHdl, ConnectionHdl, Response,
};
use std::os::raw::c_char;

/// A buffer for webapi results
pub struct Buffer<'conn, T> {
    connection: &'conn Connection,
    data_handle: BufferHdl,
    data_size: usize,
    table: Option<T>,
}

impl<'conn, 'buffer, T: flatbuffers::Follow<'buffer, Inner = T>> Buffer<'conn, T> {
    /// Create from data
    pub fn from_data(connection: &'conn Connection, data_handle: BufferHdl, data_size: usize) -> Self {
        Self {
            connection,
            data_handle,
            data_size,
            table: None,
        }
    }

    /// Access a buffer
    pub fn access(&'buffer mut self) -> &'buffer T {
        unsafe {
            match self.table {
                None => {
                    let p = self.connection.access_buffer(self.data_handle);
                    let s: &'buffer [u8] = std::slice::from_raw_parts(p, self.data_size);
                    self.table = Some(flatbuffers::get_root::<T>(s));
                    self.table.as_ref().unwrap()
                }
                Some(ref t) => t,
            }
        }
    }
}

impl<'conn, T> Drop for Buffer<'conn, T> {
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
            Ok(())
        }
    }

    /// Access a buffer
    pub(self) fn access_buffer(&self, buffer: BufferHdl) -> *const u8 {
        unsafe { duckdb_webapi_access_buffer(self.conn, buffer) }
    }

    /// Release a buffer
    pub(self) fn release_buffer(&self, buffer: BufferHdl) {
        unsafe { duckdb_webapi_release_buffer(self.conn, buffer) }
    }

    /// Register a buffer
    pub fn register_buffer(&self, buffer_ptr: *const u8, buffer_length: u32) {
        unsafe { duckdb_webapi_register_buffer(self.conn, buffer_ptr, buffer_length) }
    }

    /// Run a query
    pub fn run_query<'conn>(&'conn self, text: *const c_char) -> Result<Buffer<'conn, QueryResult>, Error> {
        let mut r = Response::default();
        unsafe {
            duckdb_webapi_run_query(&mut r, self.conn, text);
            if r.status_code == (StatusCode::ERROR as u64) {
                let err = r.as_error()?;
                return Err(Error::RawError(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
        }
    }

    /// Send a query
    pub fn send_query<'conn>(&'conn self, text: *const c_char) -> Result<Buffer<'conn, QueryResult>, Error> {
        let mut r = Response::default();
        unsafe {
            duckdb_webapi_send_query(&mut r, self.conn, text);
            if r.status_code == (StatusCode::ERROR as u64) {
                let err = r.as_error()?;
                return Err(Error::RawError(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
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

pub struct WebAPI {}

#[allow(dead_code)]
impl WebAPI {
    /// Init webapi
    pub fn init() {
        unsafe { duckdb_webapi_init() }
    }

    /// Connect
    pub fn connect() -> Result<Connection, ()> {
        Err(())
    }
}
