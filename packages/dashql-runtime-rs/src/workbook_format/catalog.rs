//! The catalog files of a connection as structure: the tables with their columns and the functions with their
//! parameters. The workbook tables carry catalogs as rows, the files on disk stay SQL.
//!
//! Reading the SQL of a catalog file and rendering it again belong to the catalog of a connection
//! (`connections/catalog/catalog_structure.ts`), the workbook format takes them as a `CatalogSql`.

use std::sync::Arc;

use dashql_core::error::Result;

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
