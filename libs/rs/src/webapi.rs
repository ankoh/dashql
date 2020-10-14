use std::os::raw::c_char;
use crate::webapi_bindings::{
    ConnectionHdl,
    Response,
    duckdb_webapi_init,
    duckdb_webapi_disconnect,
    duckdb_webapi_run_query
};

pub struct Connection {
    conn: ConnectionHdl,
}

#[allow(dead_code)]
impl Connection {
    pub fn disconnect(&self) -> Result<(), ()> {
        unsafe {
            duckdb_webapi_disconnect(self.conn);
            Ok(())
        }
    }
    pub fn run_query(&self, text: *const c_char) {
        unsafe {
            let mut response = Response::default();
            duckdb_webapi_run_query(&mut response, self.conn, text);
        }
    }
    pub fn send_query(_test: &str) {}
    pub fn fetch_query_results() {}
    pub fn analyze_query() {}
}

pub struct WebAPI {
}

#[allow(dead_code)]
impl WebAPI {
    pub fn init() {
        unsafe {
            duckdb_webapi_init()
        }
    }

    pub fn connect() -> Result<Connection, ()> {
        Err(())
    }
}
