//! The SQL that the catalog loader generates: quoting, the conditions that select relations, the statements of the
//! catalog files and the headers of the function script.
//!
//! Ported from `catalog_sql_generator.ts`, `catalog_function_sql_generator.ts` and `utils/sql_quote.ts` of
//! `packages/dashql/src/runtime/`.

use crate::connections::{RelationName, Timestamp, DEFAULT_DATABASE_NAME};

/// A quoted identifier, for Hyper, Trino and PostgreSQL alike
pub fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

/// A string literal
pub fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
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
            parts.push(format!("{schema_column} = {}", quote_literal(&relation.schema_name)));
        }
        if !relation.table_name.is_empty() {
            parts.push(format!("{table_column} = {}", quote_literal(&relation.table_name)));
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

/// The time of a refresh in ISO 8601 with milliseconds, e.g. `2026-01-01T00:00:00.000Z`
pub fn iso_timestamp(ms: Timestamp) -> String {
    let ms = if ms.is_finite() { ms.floor() as i64 } else { 0 };
    let days = ms.div_euclid(86_400_000);
    let time = ms.rem_euclid(86_400_000);
    // The civil date of the days since the epoch, Howard Hinnant's algorithm
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1_000 % 60,
        time % 1_000
    )
}

/// Where the functions of a connection come from
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogSource {
    InformationSchema,
    PgClass,
    SalesforceMetadataApi,
    /// The bundled function catalog of Hyper
    Hyper,
    Unknown,
}

impl CatalogSource {
    /// The name of the source in the header of the function script
    pub fn label(self) -> &'static str {
        match self {
            CatalogSource::InformationSchema => "SQL information_schema",
            CatalogSource::PgClass => "SQL pg_proc",
            CatalogSource::SalesforceMetadataApi => "Salesforce Connect /ssot/metadata API",
            CatalogSource::Hyper => "Bundled Hyper function catalog",
            CatalogSource::Unknown => "-",
        }
    }
}

/// The source of the functions of the embedded Hyper, its `pg_proc`
pub const HYPER_WASM_PG_PROC_SOURCE: &str = "HyperDB WASM pg_proc";

/// The header of the script with the functions of a connection
pub fn function_script_header(source: &str, updated_at: Timestamp) -> String {
    format!(
        "-- DashQL Connection Functions.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: {source}
-- Last Refresh: {}

",
        iso_timestamp(updated_at)
    )
}

/// A function that a metadata query reported
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FunctionMetadata {
    /// The schema, none to qualify the function with the database only
    pub schema_name: Option<String>,
    /// The name
    pub function_name: String,
    /// The parameters as SQL, none for none
    pub arguments: Option<String>,
    /// The return type, `any` if none
    pub return_type: Option<String>,
    /// Is it an aggregate?
    pub is_aggregate: bool,
}

/// A `CREATE FUNCTION` or `CREATE AGGREGATE` of a function of a database, the database `hyper` if there is none
pub fn create_function_sql(database_name: Option<&str>, function: &FunctionMetadata) -> String {
    let database = quote_identifier(database_name.filter(|database| !database.is_empty()).unwrap_or(DEFAULT_DATABASE_NAME));
    let name = match &function.schema_name {
        Some(schema) => format!("{database}.{}.{}", quote_identifier(schema), quote_identifier(&function.function_name)),
        None => format!("{database}.{}", quote_identifier(&function.function_name)),
    };
    let keyword = if function.is_aggregate { "AGGREGATE" } else { "FUNCTION" };
    format!(
        "CREATE {keyword} {name}({}) RETURNS {}",
        function.arguments.as_deref().unwrap_or(""),
        function.return_type.as_deref().unwrap_or("any")
    )
}

/// The statements of functions, sorted by schema and name, one per line
pub fn functions_sql(database_name: Option<&str>, functions: &[FunctionMetadata]) -> String {
    let mut sorted: Vec<&FunctionMetadata> = functions.iter().collect();
    sorted.sort_by(|a, b| {
        let schema = |f: &FunctionMetadata| f.schema_name.clone().unwrap_or_default();
        schema(a).cmp(&schema(b)).then_with(|| a.function_name.cmp(&b.function_name))
    });
    let statements: Vec<String> =
        sorted.into_iter().map(|function| format!("{};", create_function_sql(database_name, function))).collect();
    statements.join("\n")
}
