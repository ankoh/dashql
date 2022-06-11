use arrow::ipc::reader::FileReader;
use ffi::{
    duckdbx_access_buffer, duckdbx_connect, duckdbx_connection_run_query, duckdbx_noop_deleter, duckdbx_open,
    ConnectionPtr, DatabasePtr, DeleterPtr, FFIResult,
};
use std::io::Cursor;

pub mod ffi;
pub mod stream;

pub struct Database {
    inner: DatabasePtr,
    deleter: DeleterPtr,
}

pub struct Connection {
    inner: ConnectionPtr,
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
            data_deleter: duckdbx_noop_deleter,
        };
        unsafe {
            duckdbx_open(&mut result, std::ptr::null());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, DatabasePtr>(result.data);
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
            data_deleter: duckdbx_noop_deleter,
        };
        let c_path = std::ffi::CString::new(path).unwrap_or_default();
        unsafe {
            duckdbx_open(&mut result, c_path.as_ptr());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, DatabasePtr>(result.data);
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
            data_deleter: duckdbx_noop_deleter,
        };
        unsafe {
            duckdbx_connect(&mut result, self.inner);
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let data = std::mem::transmute::<*mut cty::c_void, ConnectionPtr>(result.data);
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
            data_deleter: duckdbx_noop_deleter,
        };
        let c_query = std::ffi::CString::new(query).unwrap_or_default();
        unsafe {
            duckdbx_connection_run_query(&mut result, self.inner, c_query.as_ptr());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let read_batches = || {
                let mut data: *const cty::c_char = std::ptr::null();
                let mut data_length: cty::c_int = 0;
                duckdbx_access_buffer(result.data, &mut data, &mut data_length);
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
