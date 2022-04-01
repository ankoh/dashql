use crate::error::StringError;
use std::error::Error;

#[repr(C, packed)]
struct FFIResponse {
    status: libc::uintptr_t,
    data_or_value: libc::uintptr_t,
    data_size: libc::uintptr_t,
}

#[link(name = "dashql_parser")]
extern "C" {
    fn dashql_parse(response: *mut FFIResponse, text: *const u8, text_length: libc::size_t) -> ();
}

pub fn parse(text: &str) -> Result<Box<[u8]>, Box<dyn Error + Send + Sync>> {
    let mut response = FFIResponse {
        status: 0,
        data_or_value: 0,
        data_size: 0,
    };
    unsafe {
        dashql_parse(&mut response, text.as_bytes().as_ptr(), text.len());
        match response.status {
            0 => {
                let data = std::slice::from_raw_parts_mut(
                    response.data_or_value as *mut u8,
                    response.data_size,
                );
                Ok(Box::from_raw(data))
            }
            _ => {
                let msg = String::from_raw_parts(
                    response.data_or_value as *mut u8,
                    response.data_size,
                    response.data_size,
                );
                Err(Box::new(StringError::from_string(msg)))
            }
        }
    }
}
