mod native_database;
mod native_runtime;

pub mod database {
    use crate::error::SystemError;

    pub use super::native_database::*;

    pub async fn open_in_memory() -> Result<NativeDatabase, SystemError> {
        super::native_database::NativeDatabase::open_in_memory().await
    }
}
pub mod parser {
    use crate::error::SystemError;
    use dashql_proto as proto;

    pub async fn parse(text: &str) -> Result<dashql_parser::ProgramBuffer, SystemError> {
        dashql_parser::parse(text).map_err(|e| SystemError::Generic(e))
    }
    pub async fn parse_into<'a, 'b>(
        alloc: &'a bumpalo::Bump,
        text: &'b str,
    ) -> Result<(proto::Program<'a>, &'a [u8]), SystemError> {
        dashql_parser::parse_into(alloc, text).map_err(|e| SystemError::Generic(format!("{}", e)))
    }
}
pub mod runtime {
    pub use super::native_runtime::*;
}
