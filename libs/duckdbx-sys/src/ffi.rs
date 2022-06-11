use cty;

pub type DeleterPtr = extern "C" fn(*mut cty::c_void);
pub type DatabasePtr = *mut cty::c_void;
pub type ConnectionPtr = *mut cty::c_void;

#[repr(C)]
pub struct FFIResult {
    pub status_code: u32,
    pub data_length: u32,
    pub data: *mut cty::c_void,
    pub data_deleter: DeleterPtr,
}

pub extern "C" fn duckdbx_noop_deleter(_data: *mut cty::c_void) {}

extern "C" {
    pub fn duckdbx_open(result: *mut FFIResult, path: *const cty::c_char);
    pub fn duckdbx_connect(result: *mut FFIResult, db_ptr: DatabasePtr);
    pub fn duckdbx_access_buffer(buffer: *mut cty::c_void, data: *mut *const cty::c_char, length: *mut cty::c_int);
    pub fn duckdbx_connection_run_query(result: *mut FFIResult, conn: ConnectionPtr, query: *const cty::c_char);
    // fn duckdbx_connection_send_query(result: *mut FFIResult, conn: ConnPtr, query: *const cty::c_char);
    // fn duckdbx_connection_fetch_query_results(result: *mut FFIResult, conn: ConnPtr);
}
