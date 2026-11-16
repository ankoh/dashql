//! The columns of the relations of a PostgreSQL catalog, Hyper reads its relations with them.
//!
//! Ported from `catalog_query_pg_attribute.ts` of `packages/dashql/src/runtime/connections/catalog/`.

use arrow_array::RecordBatch;

use super::columns::{batches_with_rows, Integers, Strings};
use super::sql::{quote_identifier, relation_filter};
use super::tables::{catalog_tables_of_schema, CatalogTable, ColumnMetadata, Groups, SchemaTables};
use super::{CatalogLoadError, CatalogQuery, CATALOG_QUERY_READ_TIMEOUT_MS};
use crate::connections::RelationName;
use crate::query::QueryType;

/// What a query of `pg_attribute` reads
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PgAttributeScope {
    /// The database to read the catalog of, the default database if none
    pub query_database_name: Option<String>,
    /// The relations, all relations if none
    pub relations: Option<Vec<RelationName>>,
}

/// The query of the columns of relations
pub fn pg_attribute_query_sql(scope: &PgAttributeScope) -> String {
    let pg_catalog = match &scope.query_database_name {
        None => "pg_catalog".to_string(),
        Some(database) => format!("{}.{}", quote_identifier(database), quote_identifier("pg_catalog")),
    };
    let (relations_filter, system_filter) = match &scope.relations {
        Some(relations) => (
            format!("AND {}", relation_filter("n.nspname", "c.relname", relations)),
            // A name without a schema doesn't mean a table of the system
            "AND n.nspname NOT IN ('pg_catalog', 'information_schema')".to_string(),
        ),
        None => (String::new(), String::new()),
    };
    format!(
        "
        SELECT
            n.nspname AS table_schema,
            c.relname AS table_name,
            a.attname AS column_name,
            a.attnum AS ordinal_position,
            t.typname AS data_type
        FROM {pg_catalog}.pg_class c
        JOIN {pg_catalog}.pg_namespace n ON n.oid = c.relnamespace
        JOIN {pg_catalog}.pg_attribute a ON a.attrelid = c.oid
        JOIN {pg_catalog}.pg_type t ON t.oid = a.atttypid
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        {relations_filter}
        {system_filter}
        ORDER BY n.nspname, c.relname, a.attnum
    "
    )
}

/// The query of the columns of relations
pub fn pg_attribute_query(scope: &PgAttributeScope) -> CatalogQuery {
    CatalogQuery {
        sql: pg_attribute_query_sql(scope),
        query_type: QueryType::CatalogQueryPgAttribute,
        title: "Query Postgres Schema Columns".to_string(),
        read_timeout_ms: Some(CATALOG_QUERY_READ_TIMEOUT_MS),
    }
}

/// The tables of the rows of `pg_attribute`, grouped by schema and table, in a database. Rows without a name are
/// skipped.
pub fn catalog_tables_from_pg_attribute(batches: &[RecordBatch], database_name: &str) -> Result<Vec<CatalogTable>, CatalogLoadError> {
    let mut schemas: Groups<String, SchemaTables> = Groups::new();
    for batch in batches_with_rows(batches) {
        let table_schemas = Strings::of(batch, "table_schema")?;
        let table_names = Strings::of(batch, "table_name")?;
        let column_names = Strings::of(batch, "column_name")?;
        let ordinal_positions = Integers::of(batch, "ordinal_position")?;
        let data_types = Strings::of(batch, "data_type")?;
        for row in 0..batch.num_rows() {
            let (Some(schema), Some(table), Some(column)) = (table_schemas.get(row), table_names.get(row), column_names.get(row))
            else {
                continue;
            };
            if schema.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }
            let columns = schemas.entry(&schema.to_string()).entry(&table.to_string());
            columns.push(ColumnMetadata {
                name: column.to_string(),
                ordinal_position: ordinal_positions.get(row).unwrap_or(columns.len() as i64),
                data_type: data_types.get(row).map(str::to_string),
            });
        }
    }
    let mut tables = Vec::new();
    for (schema, schema_tables) in schemas.into_entries() {
        tables.extend(catalog_tables_of_schema(database_name, &schema, schema_tables.into_entries()));
    }
    Ok(tables)
}
