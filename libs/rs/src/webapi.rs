use crate::webapi_bindings;

pub(crate) struct Connection {
    handle: webapi_bindings::ConnectionHandle,
}

#[allow(dead_code)]
impl Connection {
    pub fn disconnect(&self) -> Result<(), ()> {
        unsafe {
            webapi_bindings::duckdb_webapi_disconnect(self.handle);
            Ok(())
        }
    }
    pub fn run_query(_text: &str) {}
    pub fn send_query(_test: &str) {}
    pub fn fetch_query_results() {}
    pub fn analyze_query() {}
}

pub(crate) struct WebAPI {
}

#[allow(dead_code)]
impl WebAPI {
    pub fn init() {
        unsafe {
            webapi_bindings::duckdb_webapi_init()
        }
    }

    pub fn connect() -> Result<Connection, ()> {
        Err(())
    }
}
