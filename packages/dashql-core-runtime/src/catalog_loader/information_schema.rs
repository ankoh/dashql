//! The columns of the `information_schema` of the catalogs of a connection, Trino reads its catalog with them.

use arrow_array::RecordBatch;

use super::columns::{batches_with_rows, Integers, Strings};
use super::sql::{quote_identifier, quote_literal, relation_filter};
use super::tables::{catalog_tables_of_schema, CatalogTable, ColumnMetadata, Groups, SchemaTables};
use super::{CatalogLoadError, CatalogQuery};
use crate::connections::RelationName;
use crate::query::QueryType;

/// A catalog and the schemas of it whose columns are read
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InformationSchemaScope {
    /// The catalog name
    pub catalog: String,
    /// The schema names, empty for all schemas of the catalog
    pub schemas: Vec<String>,
    /// The relations, all relations of the schemas if none
    pub relations: Option<Vec<RelationName>>,
}

impl InformationSchemaScope {
    /// All schemas of a catalog
    pub fn catalog(catalog: &str) -> Self {
        Self { catalog: catalog.to_string(), schemas: Vec::new(), relations: None }
    }
}

/// The query of the columns of the scopes. Every catalog has an `information_schema` of its own, the query reads the
/// one of every catalog.
pub fn information_schema_columns_query(scopes: &[InformationSchemaScope]) -> String {
    let condition = |scope: &InformationSchemaScope| match &scope.relations {
        Some(relations) => format!(
            "\nWHERE table_schema <> 'information_schema' AND {}",
            relation_filter("table_schema", "table_name", relations)
        ),
        None if !scope.schemas.is_empty() => {
            let schemas: Vec<String> = scope.schemas.iter().map(|schema| quote_literal(schema)).collect();
            format!("\nWHERE table_schema IN ({})", schemas.join(", "))
        }
        None => String::new(),
    };
    let selects: Vec<String> = scopes
        .iter()
        .map(|scope| {
            format!(
                "SELECT
    table_catalog,
    table_schema,
    table_name,
    column_name,
    ordinal_position,
    data_type
FROM {}.information_schema.columns{}",
                quote_identifier(&scope.catalog),
                condition(scope)
            )
        })
        .collect();
    selects.join("\nUNION ALL\n")
}

/// The query of the `information_schema` of the scopes
pub fn information_schema_query(scopes: &[InformationSchemaScope]) -> CatalogQuery {
    CatalogQuery {
        sql: information_schema_columns_query(scopes),
        query_type: QueryType::CatalogQueryInformationSchema,
        title: "Information Schema".to_string(),
        read_timeout_ms: None,
    }
}

/// The scopes of relations: their catalogs in the order of their first relation
pub fn relation_scopes(relations: &[RelationName]) -> Vec<InformationSchemaScope> {
    let mut catalogs: Groups<String, Vec<RelationName>> = Groups::new();
    for relation in relations {
        catalogs.entry(&relation.database_name).push(relation.clone());
    }
    catalogs
        .into_entries()
        .into_iter()
        .map(|(catalog, relations)| InformationSchemaScope { catalog, schemas: Vec::new(), relations: Some(relations) })
        .collect()
}

/// The tables of the rows of the `information_schema`, grouped by catalog, schema and table. Rows without a name are
/// skipped.
pub fn catalog_tables_from_information_schema(batches: &[RecordBatch]) -> Result<Vec<CatalogTable>, CatalogLoadError> {
    let mut catalogs: Groups<String, Groups<String, SchemaTables>> = Groups::new();
    for batch in batches_with_rows(batches) {
        let table_catalogs = Strings::of(batch, "table_catalog")?;
        let table_schemas = Strings::of(batch, "table_schema")?;
        let table_names = Strings::of(batch, "table_name")?;
        let column_names = Strings::of(batch, "column_name")?;
        let ordinal_positions = Integers::of(batch, "ordinal_position")?;
        let data_types = Strings::of(batch, "data_type")?;
        for row in 0..batch.num_rows() {
            let (Some(catalog), Some(schema), Some(table), Some(column)) =
                (table_catalogs.get(row), table_schemas.get(row), table_names.get(row), column_names.get(row))
            else {
                continue;
            };
            if catalog.is_empty() || schema.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }
            let columns = catalogs.entry(&catalog.to_string()).entry(&schema.to_string()).entry(&table.to_string());
            columns.push(ColumnMetadata {
                name: column.to_string(),
                ordinal_position: ordinal_positions.get(row).unwrap_or(columns.len() as i64),
                data_type: data_types.get(row).map(str::to_string),
            });
        }
    }
    let mut tables = Vec::new();
    for (catalog, schemas) in catalogs.into_entries() {
        for (schema, schema_tables) in schemas.into_entries() {
            tables.extend(catalog_tables_of_schema(&catalog, &schema, schema_tables.into_entries()));
        }
    }
    Ok(tables)
}
