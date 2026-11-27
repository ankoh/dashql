//! The SQL that the catalog loader generates: quoting, the conditions that select relations, the statements of the
//! catalog files and the headers of the function script.

use dashql_core::utils::quote_string_literal;

use crate::connections::{RelationName, Timestamp, DEFAULT_DATABASE_NAME};

/// A quoted identifier, for Hyper, Trino and PostgreSQL alike
pub fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// The type of a column of a generated `CREATE TABLE`. A backend can name any type, such as `USER-DEFINED` or
/// `numeric(10,2)`, and some of those aren't SQL types. A quoted name always parses, and the catalog keeps its text.
pub fn quote_data_type(sql_type: Option<&str>) -> String {
    let sql_type = sql_type.map(str::trim).filter(|sql_type| !sql_type.is_empty()).unwrap_or("unknown");
    quote_identifier(sql_type)
}

/// The condition of a metadata query that selects relations. A relation without a schema matches every schema, one
/// without a table the whole schema.
pub fn relation_filter(schema_column: &str, table_column: &str, relations: &[RelationName]) -> String {
    let relation = |relation: &RelationName| {
        let mut parts = Vec::with_capacity(2);
        if !relation.schema_name.is_empty() {
            parts.push(format!("{schema_column} = {}", quote_string_literal(&relation.schema_name)));
        }
        if !relation.table_name.is_empty() {
            parts.push(format!("{table_column} = {}", quote_string_literal(&relation.table_name)));
        }
        format!("({})", parts.join(" AND "))
    };
    let relations: Vec<String> = relations.iter().map(relation).collect();
    format!("({})", relations.join(" OR "))
}

/// A qualified table name `database.schema.table`, the database `hyper` if there is none
pub fn qualified_table_name(database_name: Option<&str>, schema_name: &str, table_name: &str) -> String {
    let database = database_name.filter(|database| !database.is_empty()).unwrap_or(DEFAULT_DATABASE_NAME);
    format!("{}.{}.{}", quote_identifier(database), quote_identifier(schema_name), quote_identifier(table_name))
}

/// The source of the bundled function catalog of Hyper
pub const BUNDLED_HYPER_FUNCTIONS_SOURCE: &str = "Bundled Hyper function catalog";

/// The source of the functions that a Hyper connection read from its `pg_proc`
pub const HYPER_PG_PROC_SOURCE: &str = "Hyper pg_proc";

/// The header of the script with the functions of a connection
pub fn function_script_header(source: &str, updated_at: Timestamp) -> String {
    format!(
        "-- DashQL Connection Functions.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: {source}
-- Last Refresh: {}

",
        crate::time::iso_timestamp_f64(updated_at)
    )
}
