use crate::error::RawError;
use dashql_proto as proto;
use std::error::Error;

mod error;

#[derive(Clone, Debug)]
pub struct ASTBuffer {
    /// The program buffer
    buffer: Vec<u8>,
}

impl ASTBuffer {
    /// Construct a program buffer
    pub fn new(buffer: Vec<u8>) -> Self {
        Self { buffer }
    }
    /// Get the program
    pub fn get_root<'buf>(&'buf self) -> proto::syntax::Program<'buf> {
        flatbuffers::root::<proto::syntax::Program>(self.buffer.as_ref()).unwrap()
    }
}

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

/// Parse a text and return a program buffer
pub fn parse(text: &str) -> Result<ASTBuffer, Box<dyn Error + Send + Sync>> {
    let mut response = FFIResponse {
        status: 0,
        data_or_value: 0,
        data_size: 0,
    };
    unsafe {
        dashql_parse(&mut response, text.as_bytes().as_ptr(), text.len());
        match response.status {
            0 => {
                let buffer = std::slice::from_raw_parts(
                    response.data_or_value as *mut u8,
                    response.data_size,
                )
                .to_vec();
                {
                    flatbuffers::root::<proto::syntax::Program>(buffer.as_ref())?;
                }
                Ok(ASTBuffer::new(buffer))
            }
            _ => {
                let msg = String::from_raw_parts(
                    response.data_or_value as *mut u8,
                    response.data_size,
                    response.data_size,
                );
                Err(RawError::from(msg).boxed())
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test {
    use dashql_proto as proto;
    use std::error::Error;

    #[test]
    fn test_parser_call() -> Result<(), Box<dyn Error + Send + Sync>> {
        let program = super::parse("select 1;")?;
        let reader = program.get_root();
        let stmts = reader.statements().expect("must have statements");
        assert_eq!(stmts.len(), 1);
        assert_eq!(
            stmts.get(0).statement_type(),
            proto::syntax::StatementType::SELECT
        );
        Ok(())
    }
}