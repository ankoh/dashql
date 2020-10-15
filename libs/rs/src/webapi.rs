use crate::error::Error;
use crate::proto::{QueryPlan, QueryResult, QueryResultChunk, StatusCode};
use crate::webapi_bindings::*;
use std::ffi::CStr;
use std::os::raw::c_char;

/// A buffer for WebAPI results
pub struct Buffer<'conn, T> {
    connection: &'conn Connection,
    data_handle: BufferHdl,
    data_size: usize,
    table: Option<T>,
}

impl<'buffer, 'conn: 'buffer, T: 'buffer + flatbuffers::Follow<'buffer, Inner = T>> Buffer<'conn, T> {
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
    pub fn access(&mut self) -> &T {
        match self.table {
            Some(ref t) => t,
            None => unsafe {
                let p = self.connection.access_buffer(self.data_handle);
                let s = std::slice::from_raw_parts(p, self.data_size);
                self.table = Some(flatbuffers::get_root::<T>(s));
                self.table.as_ref().unwrap()
            }
        }
    }
}

impl<'conn, T> Drop for Buffer<'conn, T> {
    fn drop(&mut self) {
        self.connection.release_buffer(self.data_handle);
    }
}

/// A connection to DuckDB
pub struct Connection {
    conn: ConnectionHdl,
}

#[allow(dead_code)]
impl Connection {
    /// Construct a connection from a handle
    pub fn from_handle(conn: ConnectionHdl) -> Self {
        Self { conn }
    }

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
                return Err(Error::Raw(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
        }
    }

    /// Send a query
    pub fn send_query<'conn>(&'conn self, text: &CStr) -> Result<Buffer<'conn, QueryResult>, Error> {
        let mut r = Response::default();
        unsafe {
            duckdb_webapi_send_query(&mut r, self.conn, text.as_ptr());
            if r.status_code == (StatusCode::ERROR as u64) {
                let err = r.as_error()?;
                return Err(Error::Raw(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
        }
    }

    /// Fetch query results
    pub fn fetch_query_results<'conn>(&'conn self) -> Result<Buffer<'conn, QueryResultChunk>, Error> {
        let mut r = Response::default();
        unsafe {
            duckdb_webapi_fetch_query_results(&mut r, self.conn);
            if r.status_code == (StatusCode::ERROR as u64) {
                let err = r.as_error()?;
                return Err(Error::Raw(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
        }
    }

    /// Analyze query
    pub fn analyze_query<'conn>(&'conn self, text: *const c_char) -> Result<Buffer<'conn, QueryPlan>, Error> {
        let mut r = Response::default();
        unsafe {
            duckdb_webapi_analyze_query(&mut r, self.conn, text);
            if r.status_code == (StatusCode::ERROR as u64) {
                let err = r.as_error()?;
                return Err(Error::Raw(err));
            }
            let (b, n) = r.as_buffer();
            Ok(Buffer::from_data(self, b, n))
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        unsafe {
            duckdb_webapi_disconnect(self.conn);
        }
    }
}

/// A DuckDB database
pub struct DuckDB {}

#[allow(dead_code)]
impl DuckDB {
    /// Init webapi
    pub fn init() {
        unsafe { duckdb_webapi_init() }
    }

    /// Connect
    pub fn connect() -> Result<Connection, Error> {
        unsafe {
            let conn = duckdb_webapi_connect();
            Ok(Connection::from_handle(conn))
        }
    }
}
