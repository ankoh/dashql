use super::bindings::{dashql_parse, dashql_parser_free, Response};
use super::proto::syntax::Module;
use std::convert::TryInto;
use std::ffi::c_void;
use std::os::raw::c_char;

#[derive(Debug)]
pub struct Parser {}

impl Parser {
    pub fn parse<'buffer>(input: &'buffer str) -> ParseResult<'buffer> {
        let mut response = Response::default();
        unsafe {
            dashql_parse(&mut response, input.as_ptr() as *const c_char);
        }

        ParseResult::new(response)
    }
}

pub struct ParseResult<'buffer> {
    response: Response,
    pub module: Module<'buffer>,
}

impl<'buffer> ParseResult<'buffer> {
    fn new(response: Response) -> Self {
        let data_ptr = response.data_ptr as *const u8;
        let offset = response.data_offset.try_into().unwrap();
        let data_ptr = data_ptr.wrapping_offset(offset);
        let data_size = response.data_size.try_into().unwrap();

        let slice = unsafe { std::slice::from_raw_parts(data_ptr, data_size) };
        let module = flatbuffers::get_root::<Module<'buffer>>(slice);

        Self { response, module }
    }
}

impl<'buffer> Drop for ParseResult<'buffer> {
    fn drop(&mut self) {
        let Response {
            data_ptr,
            data_size,
            ..
        } = self.response;

        unsafe {
            dashql_parser_free(data_ptr as *const c_void, data_size.try_into().unwrap());
        }
    }
}
