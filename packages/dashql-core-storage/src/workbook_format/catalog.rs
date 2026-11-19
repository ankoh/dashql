//! The catalog files of a connection as structure: the tables with their columns and the functions with their
//! parameters. The workbook tables carry catalogs as rows, the files on disk stay SQL.
//!
//! Reading the SQL of a catalog file and rendering it again belong to the catalog of a connection
//! (`catalog_loader::tables`), the workbook format takes them as a `CatalogSql`.

use std::sync::Arc;

use dashql_core::error::{Error, Result};

use dashql_core_runtime::catalog_loader::tables as loader;

/// A column of a table of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogColumn {
    /// The column name
    pub name: String,
    /// The position of the column in its table
    pub ordinal_position: u32,
    /// The type, None if the declaration names none
    pub data_type: Option<String>,
}

/// A table of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogTable {
    /// The database, empty if the declaration names none
    pub database_name: String,
    /// The schema, empty if the declaration names none
    pub schema_name: String,
    /// The table name
    pub table_name: String,
    /// The columns
    pub columns: Vec<CatalogColumn>,
}

/// A parameter of a function of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogFunctionParam {
    /// The name, None if the declaration names none
    pub name: Option<String>,
    /// The type, None if the declaration names none
    pub param_type: Option<String>,
}

/// A function of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogFunction {
    /// The database, empty if the declaration names none
    pub database_name: String,
    /// The schema, empty if the declaration names none
    pub schema_name: String,
    /// The function name
    pub function_name: String,
    /// Is it an aggregate?
    pub is_aggregate: bool,
    /// The return type, None if the declaration names none
    pub return_type: Option<String>,
    /// The parameters in their order
    pub params: Vec<CatalogFunctionParam>,
}

/// The tables and the functions of a catalog file
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CatalogStructure {
    /// The tables
    pub tables: Vec<CatalogTable>,
    /// The functions
    pub functions: Vec<CatalogFunction>,
}

/// Reads catalog files into their structure and renders them again
pub trait CatalogSql {
    /// Parse the SQL of a catalog file, fails if it can't be read
    fn parse(&self, sql: &str) -> Result<CatalogStructure>;
    /// The relations file of tables
    fn relations_sql(&self, tables: &[CatalogTable]) -> String;
    /// The functions file of functions
    fn functions_sql(&self, functions: &[CatalogFunction]) -> String;
}

impl<T: CatalogSql + ?Sized> CatalogSql for Arc<T> {
    fn parse(&self, sql: &str) -> Result<CatalogStructure> {
        (**self).parse(sql)
    }
    fn relations_sql(&self, tables: &[CatalogTable]) -> String {
        (**self).relations_sql(tables)
    }
    fn functions_sql(&self, functions: &[CatalogFunction]) -> String {
        (**self).functions_sql(functions)
    }
}

/// The catalog files read and rendered by the core: the core parses a file into a catalog descriptor, and a file is
/// rendered like the catalog loader writes it
#[derive(Debug, Clone, Copy, Default)]
pub struct CoreCatalogSql;

impl CatalogSql for CoreCatalogSql {
    fn parse(&self, sql: &str) -> Result<CatalogStructure> {
        let parsed = loader::parse_catalog_sql(sql).map_err(|error| Error::invalid_argument(error.to_string()))?;
        Ok(CatalogStructure {
            tables: parsed
                .tables
                .into_iter()
                .map(|table| CatalogTable {
                    database_name: table.database_name,
                    schema_name: table.schema_name,
                    table_name: table.table_name,
                    columns: table
                        .columns
                        .into_iter()
                        .map(|column| CatalogColumn {
                            name: column.name,
                            ordinal_position: u32::try_from(column.ordinal_position).unwrap_or(u32::MAX),
                            data_type: column.data_type,
                        })
                        .collect(),
                })
                .collect(),
            functions: parsed
                .functions
                .into_iter()
                .map(|function| CatalogFunction {
                    database_name: function.database_name,
                    schema_name: function.schema_name,
                    function_name: function.function_name,
                    is_aggregate: function.is_aggregate,
                    return_type: function.return_type,
                    params: function.params.into_iter().map(|param| CatalogFunctionParam { name: param.name, param_type: param.param_type }).collect(),
                })
                .collect(),
        })
    }

    fn relations_sql(&self, tables: &[CatalogTable]) -> String {
        let tables: Vec<loader::CatalogTable> = tables
            .iter()
            .map(|table| loader::CatalogTable {
                database_name: table.database_name.clone(),
                schema_name: table.schema_name.clone(),
                table_name: table.table_name.clone(),
                columns: table
                    .columns
                    .iter()
                    .map(|column| loader::ColumnMetadata {
                        name: column.name.clone(),
                        ordinal_position: i64::from(column.ordinal_position),
                        data_type: column.data_type.clone(),
                    })
                    .collect(),
            })
            .collect();
        loader::catalog_tables_sql(&tables)
    }

    fn functions_sql(&self, functions: &[CatalogFunction]) -> String {
        let functions: Vec<loader::CatalogFunction> = functions
            .iter()
            .map(|function| loader::CatalogFunction {
                database_name: function.database_name.clone(),
                schema_name: function.schema_name.clone(),
                function_name: function.function_name.clone(),
                is_aggregate: function.is_aggregate,
                return_type: function.return_type.clone(),
                params: function
                    .params
                    .iter()
                    .map(|param| loader::CatalogFunctionParam { name: param.name.clone(), param_type: param.param_type.clone() })
                    .collect(),
            })
            .collect();
        loader::catalog_functions_sql(&functions)
    }
}
