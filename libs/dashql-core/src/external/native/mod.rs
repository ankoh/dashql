mod native_database;
mod native_runtime;

pub mod database {
    pub use super::native_database::*;
}
pub mod parser {
    use dashql_proto as proto;
    use std::error::Error;

    pub async fn parse(text: &str) -> Result<dashql_parser::ProgramBuffer, String> {
        dashql_parser::parse(text)
    }
    pub async fn parse_into<'a>(
        alloc: &'a bumpalo::Bump,
        text: &str,
    ) -> Result<(proto::Program<'a>, &'a [u8]), Box<dyn Error + Send + Sync>> {
        dashql_parser::parse_into(alloc, text)
    }
}
pub mod runtime {
    pub use super::native_runtime::*;
}
