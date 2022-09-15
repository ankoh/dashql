use ffi::{
    duckdbx_access_buffer, duckdbx_connect, duckdbx_connection_run_query, duckdbx_noop_deleter, duckdbx_open,
    DeleterPtr, FFIResult,
};
use std::sync::{
    atomic::{AtomicPtr, Ordering},
    Arc,
};

pub mod ffi;

pub type BufferPtr = *mut cty::c_void;

pub struct FFIUniquePtr {
    ptr: AtomicPtr<cty::c_void>,
    deleter: DeleterPtr,
}

impl Drop for FFIUniquePtr {
    fn drop(&mut self) {
        let ptr = self.ptr.swap(std::ptr::null_mut(), Ordering::SeqCst);
        if ptr != std::ptr::null_mut() {
            (self.deleter)(ptr);
        }
    }
}

#[derive(Clone)]
pub struct DatabasePtr {
    database: Arc<FFIUniquePtr>,
}
#[derive(Clone)]
pub struct ConnectionPtr {
    _database: Arc<FFIUniquePtr>,
    connection: Arc<FFIUniquePtr>,
}
#[derive(Clone)]
pub struct Buffer {
    buffer: Arc<FFIUniquePtr>,
}

unsafe impl Send for DatabasePtr {}
unsafe impl Send for ConnectionPtr {}
unsafe impl Send for Buffer {}

impl DatabasePtr {
    pub fn open_in_memory() -> Result<Self, String> {
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
            let ptr = FFIUniquePtr {
                ptr: AtomicPtr::new(result.data),
                deleter: result.data_deleter,
            };
            return Ok(DatabasePtr {
                database: Arc::new(ptr),
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
            let ptr = FFIUniquePtr {
                ptr: AtomicPtr::new(result.data),
                deleter: result.data_deleter,
            };
            return Ok(DatabasePtr {
                database: Arc::new(ptr),
            });
        }
    }

    pub fn connect(&self) -> Result<ConnectionPtr, String> {
        let ptr = self.database.ptr.load(Ordering::SeqCst);
        if ptr == std::ptr::null_mut() {
            return Err("database is closed".to_string());
        }
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdbx_noop_deleter,
        };
        unsafe {
            duckdbx_connect(&mut result, ptr);
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                return Err(msg);
            }
            let ptr = FFIUniquePtr {
                ptr: AtomicPtr::new(result.data),
                deleter: result.data_deleter,
            };
            return Ok(ConnectionPtr {
                _database: self.database.clone(),
                connection: Arc::new(ptr),
            });
        }
    }
}

impl Buffer {
    pub fn access<'a>(&'a self) -> &'a mut [u8] {
        let ptr = self.buffer.ptr.load(Ordering::SeqCst);
        if ptr == std::ptr::null_mut() {
            return [].as_mut_slice();
        }
        let mut data: *const cty::c_char = std::ptr::null();
        let mut data_length: cty::c_int = 0;
        unsafe {
            duckdbx_access_buffer(ptr, &mut data, &mut data_length);
            let data = std::mem::transmute::<*const cty::c_char, *mut u8>(data);
            std::slice::from_raw_parts_mut(data, data_length as usize)
        }
    }
}

impl ConnectionPtr {
    pub fn run_query(&self, query: &str) -> Result<Buffer, String> {
        let ptr = self.connection.ptr.load(Ordering::SeqCst);
        if ptr == std::ptr::null_mut() {
            return Err("connection is closed".to_string());
        }
        let mut result = FFIResult {
            status_code: 0,
            data_length: 0,
            data: std::ptr::null_mut(),
            data_deleter: duckdbx_noop_deleter,
        };
        let c_query = std::ffi::CString::new(query).unwrap_or_default();
        unsafe {
            duckdbx_connection_run_query(&mut result, ptr, c_query.as_ptr());
            if result.status_code != 0 {
                let data = std::mem::transmute::<*mut cty::c_void, *const cty::c_char>(result.data);
                let c_msg = std::ffi::CStr::from_ptr(data);
                let msg = c_msg.to_str().unwrap_or_default().to_owned();
                (result.data_deleter)(result.data);
                return Err(msg);
            }
            let ptr = FFIUniquePtr {
                ptr: AtomicPtr::new(result.data),
                deleter: result.data_deleter,
            };
            Ok(Buffer { buffer: Arc::new(ptr) })
        }
    }
}
