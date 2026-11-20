//! The bundled function catalog of Hyper: what a Hyper or Salesforce connection knows about functions before it asked
//! the engine.

use super::sql::{function_script_header, quote_identifier, CatalogSource};
use crate::connections::Timestamp;

pub use super::prefetched_hyper_functions_sql::PREFETCHED_HYPER_FUNCTIONS_SQL;

/// The bundled functions qualified with a database, with the header of a function script
pub fn qualify_prefetched_hyper_functions(database_name: &str, updated_at: Timestamp) -> String {
    let functions =
        PREFETCHED_HYPER_FUNCTIONS_SQL.replace("\"hyper\".", &format!("{}.", quote_identifier(database_name)));
    format!("{}{functions}", function_script_header(CatalogSource::Hyper.label(), updated_at))
}
