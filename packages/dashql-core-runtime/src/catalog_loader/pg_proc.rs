//! The functions of a PostgreSQL catalog, the embedded Hyper reads its functions with them.

use arrow_array::RecordBatch;

use super::columns::{batches_with_rows, Booleans, StringLists, Strings};
use super::sql::{functions_sql, quote_identifier, FunctionMetadata};
use super::{CatalogLoadError, CatalogQuery, CATALOG_QUERY_READ_TIMEOUT_MS};
use crate::query::QueryType;

/// The query of the functions of `pg_proc`. Their parameters come as structured columns: types, names and modes.
pub const PG_PROC_QUERY: &str = "
        SELECT
            n.nspname AS function_schema,
            p.proname AS function_name,
            -- Hyper cannot cast oidvector to oid[]; format each source separately.
            CASE WHEN p.proallargtypes IS NOT NULL THEN ARRAY(
                SELECT pg_catalog.format_type(arg.type_oid, NULL)
                FROM unnest(p.proallargtypes) WITH ORDINALITY AS arg(type_oid, position)
                ORDER BY arg.position
            ) ELSE ARRAY(
                SELECT pg_catalog.format_type(arg.type_oid, NULL)
                FROM unnest(p.proargtypes) WITH ORDINALITY AS arg(type_oid, position)
                ORDER BY arg.position
            ) END AS argument_types,
            p.proargnames AS argument_names,
            p.proargmodes AS argument_modes,
            COALESCE(pg_catalog.format_type(p.prorettype, NULL), 'any') AS return_type,
            p.proretset AS returns_set,
            p.prokind AS function_kind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prokind IN ('f', 'a', 'w', 'p')
        ORDER BY n.nspname, p.proname
    ";

/// The query of the functions
pub fn pg_proc_query() -> CatalogQuery {
    CatalogQuery {
        sql: PG_PROC_QUERY.to_string(),
        query_type: QueryType::CatalogQueryPgProc,
        title: "Query Postgres Functions".to_string(),
        read_timeout_ms: Some(CATALOG_QUERY_READ_TIMEOUT_MS),
    }
}

/// A type without its quoted parts, e.g. `"my.type"` is gone, a quote without its end stays
fn without_quoted_parts(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(&c) = chars.get(at) {
        if c != '"' {
            out.push(c);
            at += 1;
            continue;
        }
        // The longest quoted part: doubled quotes inside, a single quote ends it
        let mut end = None;
        let mut scan = at + 1;
        while let Some(&c) = chars.get(scan) {
            if c != '"' {
                scan += 1;
                continue;
            }
            end = Some(scan);
            if chars.get(scan + 1) == Some(&'"') {
                scan += 2;
            } else {
                break;
            }
        }
        match end {
            Some(end) => at = end + 1,
            None => {
                out.push(c);
                at += 1;
            }
        }
    }
    out
}

/// A type that DashQL declarations don't model: a qualified custom type
fn unsupported_type(sql_type: &str) -> bool {
    without_quoted_parts(sql_type).contains('.')
}

/// The SQL of the functions of `pg_proc`
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PgProcFunctions {
    /// The `CREATE FUNCTION` statements
    pub sql: String,
    /// The functions that were skipped, as `schema.function`: set or table results and qualified custom types
    pub skipped: Vec<String>,
}

/// The function statements of the rows of `pg_proc` in a database. DashQL declarations model scalar signatures only,
/// a function with a set or table result or a qualified custom type is skipped. Invalid parameter metadata fails.
pub fn catalog_sql_from_pg_proc(batches: &[RecordBatch], database_name: Option<&str>) -> Result<PgProcFunctions, CatalogLoadError> {
    let mut functions = Vec::new();
    let mut skipped = Vec::new();
    for batch in batches_with_rows(batches) {
        let schemas = Strings::of(batch, "function_schema")?;
        let names = Strings::of(batch, "function_name")?;
        let types = StringLists::of(batch, "argument_types")?;
        let arg_names = StringLists::of(batch, "argument_names")?;
        let modes = StringLists::of(batch, "argument_modes")?;
        let returns_set = Booleans::of(batch, "returns_set")?;
        let return_types = Strings::of(batch, "return_type")?;
        let kinds = Strings::of(batch, "function_kind")?;
        for row in 0..batch.num_rows() {
            let Some(function_name) = names.get(row).filter(|name| !name.is_empty()) else {
                continue;
            };
            let schema_name = schemas.get(row);
            let types = types.get(row);
            let arg_names = arg_names.get(row);
            let modes = modes.get(row);
            let types: Option<Vec<String>> = types.into_iter().collect();
            let modes: Option<Vec<String>> = modes.into_iter().collect();
            let (Some(types), Some(modes)) = (types, modes) else {
                return Err(CatalogLoadError::failed("pg_proc returned invalid function argument metadata"));
            };
            if (!arg_names.is_empty() && arg_names.len() != types.len()) || (!modes.is_empty() && modes.len() != types.len()) {
                return Err(CatalogLoadError::failed("pg_proc returned invalid function argument metadata"));
            }
            let return_type = return_types.get(row).filter(|return_type| !return_type.is_empty());
            let unsupported = returns_set.get(row)
                || modes.iter().any(|mode| mode == "t")
                || return_type.is_none_or(unsupported_type)
                || types.iter().any(|sql_type| unsupported_type(sql_type))
                || modes.iter().any(|mode| !matches!(mode.as_str(), "i" | "o" | "b" | "v" | "t"));
            if unsupported {
                skipped.push(format!("{}.{function_name}", schema_name.unwrap_or("")));
                continue;
            }
            let arguments: Vec<String> = types
                .iter()
                .enumerate()
                .filter(|(index, _)| modes.get(*index).map(String::as_str) != Some("o"))
                .map(|(index, sql_type)| {
                    let name = arg_names
                        .get(index)
                        .cloned()
                        .flatten()
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| format!("arg{}", index + 1));
                    format!("{} {sql_type}", quote_identifier(&name))
                })
                .collect();
            functions.push(FunctionMetadata {
                schema_name: schema_name.map(str::to_string),
                function_name: function_name.to_string(),
                arguments: Some(arguments.join(", ")),
                return_type: return_type.map(str::to_string),
                is_aggregate: kinds.get(row) == Some("a"),
            });
        }
    }
    Ok(PgProcFunctions { sql: functions_sql(database_name, &functions), skipped })
}
