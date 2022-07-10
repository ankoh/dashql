#[allow(dead_code)]
pub(crate) mod duckdb_wasm_bindings;
#[allow(dead_code)]
pub(crate) mod duckdb_wasm_tokens;
pub(crate) mod wasm_database;
pub(crate) mod wasm_parser;
pub(crate) mod wasm_runtime;

pub mod database {
    use crate::error::SystemError;

    pub use super::wasm_database::{WasmDatabase, WasmDatabaseConnection};

    pub async fn open_in_memory() -> Result<WasmDatabase, SystemError> {
        super::wasm_database::WasmDatabase::open_in_memory().await
    }
}
pub mod parser {
    pub use super::wasm_parser::parse;
    pub use super::wasm_parser::parse_into;
}
pub mod runtime {
    pub use super::wasm_runtime::*;
}
