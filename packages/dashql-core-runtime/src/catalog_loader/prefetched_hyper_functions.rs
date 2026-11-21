//! The bundled function catalog of Hyper: the functions of the embedded Hyper and of Salesforce Data Cloud. A Hyper
//! server and Database.com read theirs from `pg_proc`.

use super::sql::{function_script_header, quote_identifier, CatalogSource};
use crate::connections::Timestamp;

/// The bundled function catalog of Hyper as SQL, qualified with the database `hyper`
pub const PREFETCHED_HYPER_FUNCTIONS_SQL: &str = include_str!("prefetched_hyper_functions.sql");

/// The bundled functions qualified with a database, with the header of a function script
pub fn qualify_prefetched_hyper_functions(database_name: &str, updated_at: Timestamp) -> String {
    let functions =
        PREFETCHED_HYPER_FUNCTIONS_SQL.replace("\"hyper\".", &format!("{}.", quote_identifier(database_name)));
    format!("{}{functions}", function_script_header(CatalogSource::Hyper.label(), updated_at))
}
