// Copyright (c) 2020 The DashQL Authors
use std::ffi::c_void;
use std::os::raw::c_char;

/// A packed response.
/// This is the "ugly" part of our WASM interoperability.
/// The data pointer is either 4 or 8 byte in length depending on the platform.
/// (32 bit on Wasm vs 64 bit on native)
/// We always pack it as 64 bit integer.
#[repr(C)]
#[derive(Debug, Default)]
pub struct Response {
    pub data_ptr: u64,
    pub data_size: u64,
    pub data_offset: u64,
}

extern "C" {
    pub fn dashql_parse(response: *mut Response, input: *const c_char);

    pub fn dashql_parser_free(buffer: *const c_void, size: usize);
}
