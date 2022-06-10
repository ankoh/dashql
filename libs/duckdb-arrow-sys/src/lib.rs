use cty;

type deleter_ptr = extern "C" fn(*mut cty::c_void);
type db_ptr = *mut cty::c_void;
type conn_ptr = *mut cty::c_void;

#[repr(C)]
struct FFIResult {
    status_code: u32,
    data_length: u32,
    data: *mut cty::c_void,
    data_deleter: deleter_ptr,
}

extern "C" {
    fn duckdb_arrow_open(result: *mut FFIResult, path: *const cty::c_char);
    fn duckdb_arrow_connect(result: *mut FFIResult, db_ptr: db_ptr);
    fn duckdb_arrow_connection_run_query(result: *mut FFIResult, conn: conn_ptr, query: *const cty::c_char);
    fn duckdb_arrow_connection_send_query(result: *mut FFIResult, conn: conn_ptr, query: *const cty::c_char);
    fn duckdb_arrow_connection_fetch_query_results(result: *mut FFIResult, conn: conn_ptr);
}

extern "C" fn duckdb_arrow_noop_deleter(_data: *mut cty::c_void) {}

pub struct Database {
    inner: db_ptr,
    deleter: deleter_ptr,
}

pub struct Connection {
    inner: conn_ptr,
    deleter: deleter_ptr,
}

impl Drop for Database {
    fn drop(&mut self) {
        (self.deleter)(self.inner)
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        (self.deleter)(self.inner)
    }
}

impl Database {
    pub fn open(path: &str) -> Result<Self, String> {
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdb_arrow_noop_deleter,
        };
        let c_path = std::ffi::CString::new(path).unwrap_or_default();
        unsafe {
            duckdb_arrow_open(&mut result, c_path.as_ptr());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, db_ptr>(result.data);
            return Ok(Database {
                inner: data,
                deleter: result.data_deleter,
            });
        }
    }

    pub fn connect(&self) -> Result<Connection, String> {
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdb_arrow_noop_deleter,
        };
        unsafe {
            duckdb_arrow_connect(&mut result, self.inner);
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, conn_ptr>(result.data);
            return Ok(Connection {
                inner: data,
                deleter: result.data_deleter,
            });
        }
    }
}
