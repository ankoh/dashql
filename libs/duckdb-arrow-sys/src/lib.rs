use arrow::ipc::reader::FileReader;
use cty;
use std::io::Cursor;

pub mod stream_reader;

type DeleterPtr = extern "C" fn(*mut cty::c_void);
type DbPtr = *mut cty::c_void;
type ConnPtr = *mut cty::c_void;

#[repr(C)]
struct FFIResult {
    status_code: u32,
    data_length: u32,
    data: *mut cty::c_void,
    data_deleter: DeleterPtr,
}

extern "C" {
    fn duckdb_arrow_access_buffer(buffer: *mut cty::c_void, data: *mut *const cty::c_char, length: *mut cty::c_int);
    fn duckdb_arrow_open(result: *mut FFIResult, path: *const cty::c_char);
    fn duckdb_arrow_connect(result: *mut FFIResult, DbPtr: DbPtr);
    fn duckdb_arrow_connection_run_query(result: *mut FFIResult, conn: ConnPtr, query: *const cty::c_char);
    // fn duckdb_arrow_connection_send_query(result: *mut FFIResult, conn: ConnPtr, query: *const cty::c_char);
    // fn duckdb_arrow_connection_fetch_query_results(result: *mut FFIResult, conn: ConnPtr);
}

extern "C" fn duckdb_arrow_noop_deleter(_data: *mut cty::c_void) {}

pub struct Database {
    inner: DbPtr,
    deleter: DeleterPtr,
}

pub struct Connection {
    inner: ConnPtr,
    deleter: DeleterPtr,
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
    pub fn open_transient() -> Result<Self, String> {
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdb_arrow_noop_deleter,
        };
        unsafe {
            duckdb_arrow_open(&mut result, std::ptr::null());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, DbPtr>(result.data);
            return Ok(Database {
                inner: data,
                deleter: result.data_deleter,
            });
        }
    }
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
            let data = std::mem::transmute::<*mut cty::c_void, DbPtr>(result.data);
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
            let data = std::mem::transmute::<*mut cty::c_void, ConnPtr>(result.data);
            return Ok(Connection {
                inner: data,
                deleter: result.data_deleter,
            });
        }
    }
}

impl Connection {
    pub fn run_query(&self, query: &str) -> Result<Vec<arrow::record_batch::RecordBatch>, String> {
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdb_arrow_noop_deleter,
        };
        let c_query = std::ffi::CString::new(query).unwrap_or_default();
        unsafe {
            duckdb_arrow_connection_run_query(&mut result, self.inner, c_query.as_ptr());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let read_batches = || {
                let mut data: *const cty::c_char = std::ptr::null();
                let mut data_length: cty::c_int = 0;
                duckdb_arrow_access_buffer(result.data, &mut data, &mut data_length);
                let data_u8 = std::mem::transmute::<*const cty::c_char, *const u8>(data);
                let data_slice = std::slice::from_raw_parts(data_u8, data_length as usize);
                let cursor = Cursor::new(data_slice);
                let reader = FileReader::try_new(cursor, None).unwrap();
                let mut batches = Vec::new();
                for maybe_batch in reader {
                    match maybe_batch {
                        Ok(batch) => batches.push(batch),
                        Err(err) => return Err(err.to_string()),
                    }
                }
                return Ok(batches);
            };
            let batches = read_batches();
            (result.data_deleter)(result.data);
            batches
        }
    }
}
