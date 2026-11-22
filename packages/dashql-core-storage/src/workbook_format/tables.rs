//! The workbook tables: a version of a workbook as the rows of a fixed set of tables, in a `.dashql` file as
//! `<table>.parquet` and in a cloud as rows of tables of the same names and columns, see
//! `docs/design/workbook_tables.md`. Every row starts with the key of its version, `(workbook_id, version_id)`.
//!
//! Parquet stays with the embedded Hyper of the host: a table crosses as Arrow IPC (`encode_table_ipc`), which the
//! host writes as Parquet, and the host scans a Parquet file into Arrow IPC that `decode_table_ipc` reads.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use arrow_array::{Array, ArrayRef, BooleanArray, Int32Array, RecordBatch, StringArray};
use arrow_schema::{DataType, Field, Schema};
use serde_json::{json, Value};

use dashql_core::error::{Error, Result};

use crate::workbook_format::bundle::{
    assemble_workbook_bundle, bundle_catalog_path, check_workbook_bundle, read_workbook_bundle_head, DataFileData,
    ScriptData, WorkbookBundle, WorkbookBundleResult,
};
use crate::workbook_format::files::nfc;
use crate::workbook_format::json::{to_text, JsonObject};
use crate::workbook_format::layout::{STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS, STORAGE_WORKBOOK_FILE};
use crate::workbook_format::migration::MigrationFolder;
use dashql_core_runtime::catalog_loader::tables::Groups;
use dashql_core_runtime::catalog_loader::tables::{
    catalog_functions_sql, catalog_tables_sql, parse_catalog_sql, CatalogFunction, CatalogFunctionParam,
    CatalogStructure, CatalogTable, ColumnMetadata,
};

/// The prefix of a table that holds the data of an attachment
pub const ATTACHMENT_TABLE_PREFIX: &str = "workbook_attachment_";
/// The prefix of a table that holds a cached query result
pub const RESULT_TABLE_PREFIX: &str = "workbook_result_";
/// The extension of a table in a `.dashql` file
pub const TABLE_FILE_EXTENSION: &str = ".parquet";

/// The type of a column of a workbook table
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnType {
    /// `text`, Arrow Utf8
    Text,
    /// `integer`, Arrow Int32
    Integer,
    /// `boolean`, Arrow Boolean
    Boolean,
}

/// A column of a workbook table
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TableColumn {
    /// The name
    pub name: &'static str,
    /// The type
    pub column_type: ColumnType,
    /// Can it be null?
    pub nullable: bool,
}

const fn text(name: &'static str, nullable: bool) -> TableColumn {
    TableColumn { name, column_type: ColumnType::Text, nullable }
}
const fn integer(name: &'static str) -> TableColumn {
    TableColumn { name, column_type: ColumnType::Integer, nullable: false }
}
const fn boolean(name: &'static str) -> TableColumn {
    TableColumn { name, column_type: ColumnType::Boolean, nullable: false }
}
/// The columns of the key of a version
const WORKBOOK_ID: TableColumn = text("workbook_id", false);
const VERSION_ID: TableColumn = text("version_id", false);

/// The workbook tables
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum WorkbookTableName {
    /// `workbook_versions`, one row per version: the workbook file of the version
    Versions,
    /// `workbook_connections`
    Connections,
    /// `workbook_scripts`
    Scripts,
    /// `connection_catalog_tables`
    CatalogTables,
    /// `connection_catalog_columns`
    CatalogColumns,
    /// `connection_catalog_functions`
    CatalogFunctions,
    /// `connection_catalog_function_params`
    CatalogFunctionParams,
    /// `workbook_attachments`
    Attachments,
    /// `workbook_results`
    Results,
}

impl WorkbookTableName {
    /// The workbook tables, the versions first
    pub const ALL: [WorkbookTableName; 9] = [
        Self::Versions,
        Self::Connections,
        Self::Scripts,
        Self::CatalogTables,
        Self::CatalogColumns,
        Self::CatalogFunctions,
        Self::CatalogFunctionParams,
        Self::Attachments,
        Self::Results,
    ];

    /// The name of the table
    pub fn name(self) -> &'static str {
        match self {
            Self::Versions => "workbook_versions",
            Self::Connections => "workbook_connections",
            Self::Scripts => "workbook_scripts",
            Self::CatalogTables => "connection_catalog_tables",
            Self::CatalogColumns => "connection_catalog_columns",
            Self::CatalogFunctions => "connection_catalog_functions",
            Self::CatalogFunctionParams => "connection_catalog_function_params",
            Self::Attachments => "workbook_attachments",
            Self::Results => "workbook_results",
        }
    }

    /// The table of a name, None for any other name
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|table| table.name() == name)
    }

    /// The columns of the table, the key of the version first
    pub fn columns(self) -> &'static [TableColumn] {
        const VERSIONS: [TableColumn; 5] =
            [WORKBOOK_ID, VERSION_ID, integer("format_version"), text("name", true), text("metadata", false)];
        const CONNECTIONS: [TableColumn; 6] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("position"),
            text("connection_id", false),
            text("name", true),
            text("params", false),
        ];
        const SCRIPTS: [TableColumn; 6] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("position"),
            text("name", false),
            text("connection_id", false),
            text("text", false),
        ];
        const CATALOG_TABLES: [TableColumn; 7] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("table_id"),
            text("connection_id", false),
            text("database_name", false),
            text("schema_name", false),
            text("table_name", false),
        ];
        const CATALOG_COLUMNS: [TableColumn; 6] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("table_id"),
            integer("position"),
            text("column_name", false),
            text("column_type", true),
        ];
        const CATALOG_FUNCTIONS: [TableColumn; 9] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("function_id"),
            text("connection_id", false),
            text("database_name", false),
            text("schema_name", false),
            text("function_name", false),
            boolean("is_aggregate"),
            text("return_type", true),
        ];
        const CATALOG_FUNCTION_PARAMS: [TableColumn; 6] = [
            WORKBOOK_ID,
            VERSION_ID,
            integer("function_id"),
            integer("position"),
            text("param_name", true),
            text("param_type", true),
        ];
        const ATTACHMENTS: [TableColumn; 5] =
            [WORKBOOK_ID, VERSION_ID, integer("position"), text("name", false), text("table_name", false)];
        const RESULTS: [TableColumn; 5] =
            [WORKBOOK_ID, VERSION_ID, text("cache_key", false), text("table_name", false), text("script_name", true)];
        match self {
            Self::Versions => &VERSIONS,
            Self::Connections => &CONNECTIONS,
            Self::Scripts => &SCRIPTS,
            Self::CatalogTables => &CATALOG_TABLES,
            Self::CatalogColumns => &CATALOG_COLUMNS,
            Self::CatalogFunctions => &CATALOG_FUNCTIONS,
            Self::CatalogFunctionParams => &CATALOG_FUNCTION_PARAMS,
            Self::Attachments => &ATTACHMENTS,
            Self::Results => &RESULTS,
        }
    }

    /// The file name of the table in a `.dashql` file
    pub fn file_name(self) -> String {
        workbook_table_file_name(self.name())
    }
}

/// The file name of a table in a `.dashql` file
pub fn workbook_table_file_name(table_name: &str) -> String {
    format!("{table_name}{TABLE_FILE_EXTENSION}")
}

/// Is a name the name of a table that holds the data of an attachment or a result?
pub fn is_data_table_name(name: &str) -> bool {
    let id = name.strip_prefix(ATTACHMENT_TABLE_PREFIX).or_else(|| name.strip_prefix(RESULT_TABLE_PREFIX));
    id.is_some_and(|id| id.len() == 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// A fresh name of a table that holds the data of an attachment or a result, from a UUID
pub fn new_data_table_name(prefix: &str, uuid: &str) -> String {
    format!("{prefix}{}", uuid.replace('-', "").to_ascii_lowercase())
}

/// A value of a cell
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cell {
    /// A text, None for null
    Text(Option<String>),
    /// An integer
    Integer(i32),
    /// A boolean
    Boolean(bool),
}

/// The cells of a row, read in the order of the columns
struct CellReader {
    cells: std::vec::IntoIter<Cell>,
}

impl CellReader {
    fn text(&mut self) -> Option<String> {
        match self.cells.next() {
            Some(Cell::Text(text)) => text,
            _ => None,
        }
    }
    fn string(&mut self) -> String {
        self.text().unwrap_or_default()
    }
    fn integer(&mut self) -> i32 {
        match self.cells.next() {
            Some(Cell::Integer(value)) => value,
            _ => 0,
        }
    }
    fn boolean(&mut self) -> bool {
        matches!(self.cells.next(), Some(Cell::Boolean(true)))
    }
}

/// A row of a workbook table
pub trait WorkbookTableRow: Sized {
    /// The table of the rows
    const TABLE: WorkbookTableName;
    /// The cells in the order of the columns
    fn cells(&self) -> Vec<Cell>;
    /// The row of cells in the order of the columns, the cells were checked against the columns
    fn from_cells(cells: Vec<Cell>) -> Self;
}

macro_rules! row {
    ($(#[$doc:meta])* $row:ident, $table:expr, { $($(#[$fdoc:meta])* $field:ident: $ty:ty => $kind:ident),* $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, PartialEq, Eq)]
        pub struct $row {
            $($(#[$fdoc])* pub $field: $ty,)*
        }

        impl WorkbookTableRow for $row {
            const TABLE: WorkbookTableName = $table;
            fn cells(&self) -> Vec<Cell> {
                vec![$(row!(@cell $kind, self.$field)),*]
            }
            fn from_cells(cells: Vec<Cell>) -> Self {
                let mut reader = CellReader { cells: cells.into_iter() };
                Self { $($field: reader.$kind(),)* }
            }
        }
    };
    (@cell text, $value:expr) => { Cell::Text($value.clone()) };
    (@cell string, $value:expr) => { Cell::Text(Some($value.clone())) };
    (@cell integer, $value:expr) => { Cell::Integer($value) };
    (@cell boolean, $value:expr) => { Cell::Boolean($value) };
}

row!(
    /// A version of the workbook, the workbook file without its lists
    VersionRow, WorkbookTableName::Versions, {
    workbook_id: String => string,
    version_id: String => string,
    format_version: i32 => integer,
    name: Option<String> => text,
    /// The metadata of the workbook as JSON
    metadata: String => string,
});
row!(
    /// A connection of the workbook
    ConnectionRow, WorkbookTableName::Connections, {
    workbook_id: String => string,
    version_id: String => string,
    position: i32 => integer,
    connection_id: String => string,
    name: Option<String> => text,
    /// The params as JSON, sanitized for sharing
    params: String => string,
});
row!(
    /// A script of the workbook
    ScriptRow, WorkbookTableName::Scripts, {
    workbook_id: String => string,
    version_id: String => string,
    position: i32 => integer,
    name: String => string,
    connection_id: String => string,
    text: String => string,
});
row!(
    /// A table of the catalog of a connection
    CatalogTableRow, WorkbookTableName::CatalogTables, {
    workbook_id: String => string,
    version_id: String => string,
    /// Unique among the tables of the version
    table_id: i32 => integer,
    connection_id: String => string,
    /// Empty if the declaration names none
    database_name: String => string,
    /// Empty if the declaration names none
    schema_name: String => string,
    table_name: String => string,
});
row!(
    /// A column of a table of a catalog
    CatalogColumnRow, WorkbookTableName::CatalogColumns, {
    workbook_id: String => string,
    version_id: String => string,
    table_id: i32 => integer,
    position: i32 => integer,
    column_name: String => string,
    column_type: Option<String> => text,
});
row!(
    /// A function of the catalog of a connection
    CatalogFunctionRow, WorkbookTableName::CatalogFunctions, {
    workbook_id: String => string,
    version_id: String => string,
    /// Unique among the functions of the version
    function_id: i32 => integer,
    connection_id: String => string,
    database_name: String => string,
    schema_name: String => string,
    function_name: String => string,
    is_aggregate: bool => boolean,
    return_type: Option<String> => text,
});
row!(
    /// A parameter of a function of a catalog
    CatalogFunctionParamRow, WorkbookTableName::CatalogFunctionParams, {
    workbook_id: String => string,
    version_id: String => string,
    function_id: i32 => integer,
    position: i32 => integer,
    param_name: Option<String> => text,
    param_type: Option<String> => text,
});
row!(
    /// An attachment of the workbook and the table of its data
    AttachmentRow, WorkbookTableName::Attachments, {
    workbook_id: String => string,
    version_id: String => string,
    position: i32 => integer,
    name: String => string,
    table_name: String => string,
});
row!(
    /// The stored result of a script of the workbook and the table of its data
    ResultRow, WorkbookTableName::Results, {
    workbook_id: String => string,
    version_id: String => string,
    /// The key in the name of the file of the result
    cache_key: String => string,
    table_name: String => string,
    /// The file name of the script, null in the archives of earlier versions, which name only the key
    script_name: Option<String> => text,
});

/// The Parquet file of an attachment or a result table
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataTableFile<B> {
    /// The file
    pub bytes: B,
    /// The CRC-32 that an archive stores for the file
    pub crc32: Option<u32>,
}

/// The rows of the workbook tables, and the Parquet files of the attachment and result tables
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookTables<B> {
    pub versions: Vec<VersionRow>,
    pub connections: Vec<ConnectionRow>,
    pub scripts: Vec<ScriptRow>,
    pub catalog_tables: Vec<CatalogTableRow>,
    pub catalog_columns: Vec<CatalogColumnRow>,
    pub catalog_functions: Vec<CatalogFunctionRow>,
    pub catalog_function_params: Vec<CatalogFunctionParamRow>,
    pub attachments: Vec<AttachmentRow>,
    pub results: Vec<ResultRow>,
    /// The Parquet files of the attachment and result tables by table name, in the order they were added
    pub data: Vec<(String, DataTableFile<B>)>,
}

impl<B> Default for WorkbookTables<B> {
    fn default() -> Self {
        Self {
            versions: Vec::new(),
            connections: Vec::new(),
            scripts: Vec::new(),
            catalog_tables: Vec::new(),
            catalog_columns: Vec::new(),
            catalog_functions: Vec::new(),
            catalog_function_params: Vec::new(),
            attachments: Vec::new(),
            results: Vec::new(),
            data: Vec::new(),
        }
    }
}

impl<B> WorkbookTables<B> {
    /// The number of rows of a table
    pub fn row_count(&self, table: WorkbookTableName) -> usize {
        match table {
            WorkbookTableName::Versions => self.versions.len(),
            WorkbookTableName::Connections => self.connections.len(),
            WorkbookTableName::Scripts => self.scripts.len(),
            WorkbookTableName::CatalogTables => self.catalog_tables.len(),
            WorkbookTableName::CatalogColumns => self.catalog_columns.len(),
            WorkbookTableName::CatalogFunctions => self.catalog_functions.len(),
            WorkbookTableName::CatalogFunctionParams => self.catalog_function_params.len(),
            WorkbookTableName::Attachments => self.attachments.len(),
            WorkbookTableName::Results => self.results.len(),
        }
    }

    /// The rows of a table as Arrow IPC
    pub fn encode_table(&self, table: WorkbookTableName) -> Result<Vec<u8>> {
        match table {
            WorkbookTableName::Versions => encode_table_ipc(&self.versions),
            WorkbookTableName::Connections => encode_table_ipc(&self.connections),
            WorkbookTableName::Scripts => encode_table_ipc(&self.scripts),
            WorkbookTableName::CatalogTables => encode_table_ipc(&self.catalog_tables),
            WorkbookTableName::CatalogColumns => encode_table_ipc(&self.catalog_columns),
            WorkbookTableName::CatalogFunctions => encode_table_ipc(&self.catalog_functions),
            WorkbookTableName::CatalogFunctionParams => encode_table_ipc(&self.catalog_function_params),
            WorkbookTableName::Attachments => encode_table_ipc(&self.attachments),
            WorkbookTableName::Results => encode_table_ipc(&self.results),
        }
    }

    /// Replace the rows of a table with the rows of Arrow IPC that the host read from its Parquet file
    pub fn decode_table(&mut self, table: WorkbookTableName, ipc: &[u8]) -> Result<()> {
        match table {
            WorkbookTableName::Versions => self.versions = decode_table_ipc(ipc)?,
            WorkbookTableName::Connections => self.connections = decode_table_ipc(ipc)?,
            WorkbookTableName::Scripts => self.scripts = decode_table_ipc(ipc)?,
            WorkbookTableName::CatalogTables => self.catalog_tables = decode_table_ipc(ipc)?,
            WorkbookTableName::CatalogColumns => self.catalog_columns = decode_table_ipc(ipc)?,
            WorkbookTableName::CatalogFunctions => self.catalog_functions = decode_table_ipc(ipc)?,
            WorkbookTableName::CatalogFunctionParams => self.catalog_function_params = decode_table_ipc(ipc)?,
            WorkbookTableName::Attachments => self.attachments = decode_table_ipc(ipc)?,
            WorkbookTableName::Results => self.results = decode_table_ipc(ipc)?,
        }
        Ok(())
    }
}

fn arrow_error(error: impl std::fmt::Display) -> Error {
    Error::invalid_argument(format!("Invalid workbook tables: {error}"))
}

/// The schema of a workbook table
pub fn table_schema(table: WorkbookTableName) -> Schema {
    Schema::new(
        table
            .columns()
            .iter()
            .map(|column| {
                let data_type = match column.column_type {
                    ColumnType::Text => DataType::Utf8,
                    ColumnType::Integer => DataType::Int32,
                    ColumnType::Boolean => DataType::Boolean,
                };
                Field::new(column.name, data_type, column.nullable)
            })
            .collect::<Vec<_>>(),
    )
}

/// The rows of a workbook table as a record batch
pub fn table_to_arrow<R: WorkbookTableRow>(rows: &[R]) -> Result<RecordBatch> {
    let columns = R::TABLE.columns();
    let cells: Vec<Vec<Cell>> = rows.iter().map(WorkbookTableRow::cells).collect();
    let arrays: Vec<ArrayRef> = columns
        .iter()
        .enumerate()
        .map(|(i, column)| -> ArrayRef {
            let values = cells.iter().map(|row| row.get(i));
            match column.column_type {
                ColumnType::Text => Arc::new(
                    values
                        .map(|cell| match cell {
                            Some(Cell::Text(text)) => text.clone(),
                            _ => None,
                        })
                        .collect::<StringArray>(),
                ),
                ColumnType::Integer => Arc::new(
                    values
                        .map(|cell| match cell {
                            Some(Cell::Integer(value)) => Some(*value),
                            _ => Some(0),
                        })
                        .collect::<Int32Array>(),
                ),
                ColumnType::Boolean => Arc::new(
                    values
                        .map(|cell| match cell {
                            Some(Cell::Boolean(value)) => Some(*value),
                            _ => Some(false),
                        })
                        .collect::<BooleanArray>(),
                ),
            }
        })
        .collect();
    RecordBatch::try_new(Arc::new(table_schema(R::TABLE)), arrays).map_err(arrow_error)
}

/// The rows of a record batch of a workbook table. Missing columns of nullable fields read as null, other missing
/// columns fail, and so does a null in a column that isn't nullable. The columns are cast to their types.
pub fn table_from_arrow<R: WorkbookTableRow>(batch: &RecordBatch) -> Result<Vec<R>> {
    let table = R::TABLE;
    let mut columns: Vec<(TableColumn, Option<ArrayRef>)> = Vec::new();
    for column in table.columns() {
        let array = batch.column_by_name(column.name);
        if array.is_none() && !column.nullable {
            return Err(Error::invalid_argument(format!(
                "Invalid workbook tables: {} has no column {}",
                table.name(),
                column.name
            )));
        }
        let target = match column.column_type {
            ColumnType::Text => DataType::Utf8,
            ColumnType::Integer => DataType::Int32,
            ColumnType::Boolean => DataType::Boolean,
        };
        let array = match array {
            Some(array) if *array.data_type() == target => Some(array.clone()),
            Some(array) => Some(arrow_cast::cast(array, &target).map_err(arrow_error)?),
            None => None,
        };
        columns.push((*column, array));
    }
    let mut rows = Vec::with_capacity(batch.num_rows());
    for i in 0..batch.num_rows() {
        let mut cells = Vec::with_capacity(columns.len());
        for (column, array) in &columns {
            let present = array.as_ref().filter(|array| i < array.len() && array.is_valid(i));
            let Some(array) = present else {
                if !column.nullable {
                    return Err(Error::invalid_argument(format!(
                        "Invalid workbook tables: {}.{} is null",
                        table.name(),
                        column.name
                    )));
                }
                cells.push(Cell::Text(None));
                continue;
            };
            let any = array.as_any();
            let cell = match column.column_type {
                ColumnType::Text => any.downcast_ref::<StringArray>().map(|a| Cell::Text(Some(a.value(i).to_string()))),
                ColumnType::Integer => any.downcast_ref::<Int32Array>().map(|a| Cell::Integer(a.value(i))),
                ColumnType::Boolean => any.downcast_ref::<BooleanArray>().map(|a| Cell::Boolean(a.value(i))),
            };
            let Some(cell) = cell else {
                return Err(Error::invalid_argument(format!(
                    "Invalid workbook tables: {}.{} has the wrong type",
                    table.name(),
                    column.name
                )));
            };
            cells.push(cell);
        }
        rows.push(R::from_cells(cells));
    }
    Ok(rows)
}

/// The rows of a workbook table as an Arrow IPC stream, which the host writes as Parquet
pub fn encode_table_ipc<R: WorkbookTableRow>(rows: &[R]) -> Result<Vec<u8>> {
    let batch = table_to_arrow(rows)?;
    let mut writer = arrow_ipc::writer::StreamWriter::try_new(Vec::new(), &batch.schema()).map_err(arrow_error)?;
    writer.write(&batch).map_err(arrow_error)?;
    writer.finish().map_err(arrow_error)?;
    writer.into_inner().map_err(arrow_error)
}

/// The rows of a workbook table of an Arrow IPC stream, e.g. the scan of its Parquet file
pub fn decode_table_ipc<R: WorkbookTableRow>(ipc: &[u8]) -> Result<Vec<R>> {
    let reader = arrow_ipc::reader::StreamReader::try_new(Cursor::new(ipc), None).map_err(arrow_error)?;
    let mut rows = Vec::new();
    for batch in reader {
        rows.extend(table_from_arrow::<R>(&batch.map_err(arrow_error)?)?);
    }
    Ok(rows)
}

/// The rows of a bundle, as a version under a fresh id. The connection params are written as the bundle holds them, an
/// export sanitizes them first. The catalog files are read into their tables and functions, the version and the data
/// tables get fresh UUIDs of `new_uuid`, the version first.
pub fn workbook_bundle_to_tables<B: Clone>(
    bundle: &WorkbookBundle<B>,
    new_uuid: &mut dyn FnMut() -> String,
) -> Result<WorkbookTables<B>> {
    let mut tables = WorkbookTables::default();
    let workbook = &bundle.workbook;
    let workbook_id = workbook.workbook_id.clone();
    let version_id = new_uuid();
    tables.versions.push(VersionRow {
        workbook_id: workbook_id.clone(),
        version_id: version_id.clone(),
        format_version: i32::try_from(workbook.format_version).unwrap_or(0),
        name: workbook.name.clone(),
        metadata: to_text(&workbook.metadata.to_json()),
    });
    for (position, connection) in workbook.connections.iter().enumerate() {
        tables.connections.push(ConnectionRow {
            workbook_id: workbook_id.clone(),
            version_id: version_id.clone(),
            position: position as i32,
            connection_id: connection.connection_id.clone(),
            name: connection.name.clone(),
            params: to_text(&connection.params),
        });
    }
    for (position, script) in workbook.scripts.iter().enumerate() {
        let Some(sql) = bundle.scripts.iter().find(|s| s.name == script.name) else {
            continue;
        };
        tables.scripts.push(ScriptRow {
            workbook_id: workbook_id.clone(),
            version_id: version_id.clone(),
            position: position as i32,
            name: script.name.clone(),
            connection_id: script.connection_id.clone(),
            text: sql.sql.clone(),
        });
    }
    // The ids count the tables and the functions of all connections, in the order of their declarations
    for catalog in &bundle.catalogs {
        let connection_id = &catalog.connection_id;
        let relations = match catalog.relations.as_deref().filter(|sql| !sql.trim().is_empty()) {
            Some(sql) => parse_catalog_file(sql)?.tables,
            None => Vec::new(),
        };
        let functions = match catalog.functions.as_deref().filter(|sql| !sql.trim().is_empty()) {
            Some(sql) => parse_catalog_file(sql)?.functions,
            None => Vec::new(),
        };
        for table in relations {
            let table_id = tables.catalog_tables.len() as i32;
            tables.catalog_tables.push(CatalogTableRow {
                workbook_id: workbook_id.clone(),
                version_id: version_id.clone(),
                table_id,
                connection_id: connection_id.clone(),
                database_name: table.database_name,
                schema_name: table.schema_name,
                table_name: table.table_name,
            });
            let mut columns = table.columns;
            columns.sort_by_key(|column| column.ordinal_position);
            for (position, column) in columns.into_iter().enumerate() {
                tables.catalog_columns.push(CatalogColumnRow {
                    workbook_id: workbook_id.clone(),
                    version_id: version_id.clone(),
                    table_id,
                    position: position as i32,
                    column_name: column.name,
                    column_type: column.data_type,
                });
            }
        }
        for function in functions {
            let function_id = tables.catalog_functions.len() as i32;
            tables.catalog_functions.push(CatalogFunctionRow {
                workbook_id: workbook_id.clone(),
                version_id: version_id.clone(),
                function_id,
                connection_id: connection_id.clone(),
                database_name: function.database_name,
                schema_name: function.schema_name,
                function_name: function.function_name,
                is_aggregate: function.is_aggregate,
                return_type: function.return_type,
            });
            for (position, param) in function.params.into_iter().enumerate() {
                tables.catalog_function_params.push(CatalogFunctionParamRow {
                    workbook_id: workbook_id.clone(),
                    version_id: version_id.clone(),
                    function_id,
                    position: position as i32,
                    param_name: param.name,
                    param_type: param.param_type,
                });
            }
        }
    }
    for (position, file) in bundle.data.iter().enumerate() {
        let table_name = new_data_table_name(ATTACHMENT_TABLE_PREFIX, &new_uuid());
        tables.attachments.push(AttachmentRow {
            workbook_id: workbook_id.clone(),
            version_id: version_id.clone(),
            position: position as i32,
            name: file.name.clone(),
            table_name: table_name.clone(),
        });
        tables.data.push((table_name, DataTableFile { bytes: file.bytes.clone(), crc32: None }));
    }
    for result in &bundle.results {
        let table_name = new_data_table_name(RESULT_TABLE_PREFIX, &new_uuid());
        tables.results.push(ResultRow {
            workbook_id: workbook_id.clone(),
            version_id: version_id.clone(),
            cache_key: result.key.clone(),
            table_name: table_name.clone(),
            script_name: result.script.clone(),
        });
        tables.data.push((table_name, DataTableFile { bytes: result.bytes.clone(), crc32: result.crc32 }));
    }
    Ok(tables)
}

/// The tables and the functions of a catalog file, as the catalog of a connection reads it
fn parse_catalog_file(sql: &str) -> Result<CatalogStructure> {
    parse_catalog_sql(sql).map_err(|error| Error::invalid_argument(error.to_string()))
}

/// Parse a JSON text of a row
fn parse_json(value: &str, error_prefix: &str, table: WorkbookTableName) -> Result<Value> {
    serde_json::from_str(value)
        .map_err(|_| Error::invalid_argument(format!("{error_prefix}: invalid JSON in {}", table.name())))
}

/// The row of the one version of a set of tables
fn version_row<'a, B>(tables: &'a WorkbookTables<B>, error_prefix: &str) -> Result<&'a VersionRow> {
    let [row] = tables.versions.as_slice() else {
        return Err(Error::invalid_argument(format!(
            "{error_prefix}: expected one workbook version, found {}",
            tables.versions.len()
        )));
    };
    Ok(row)
}

/// The bundle of the workbook of a set of tables that hold one version. The workbook file is assembled from the rows and
/// migrated like a workbook folder. A data table that the tables don't carry leaves its attachment or result out.
pub fn workbook_tables_to_bundle<B: Clone>(
    tables: &WorkbookTables<B>,
    error_prefix: &str,
) -> Result<WorkbookBundle<B>> {
    let row = version_row(tables, error_prefix)?;
    let mut connections = tables.connections.clone();
    connections.sort_by_key(|row| row.position);
    // The file names in NFC, like the names of the entries of an archive
    let mut scripts = tables.scripts.clone();
    scripts.sort_by_key(|row| row.position);
    scripts.iter_mut().for_each(|script| script.name = nfc(&script.name));
    let mut attachments = tables.attachments.clone();
    attachments.sort_by_key(|row| row.position);
    attachments.iter_mut().for_each(|attachment| attachment.name = nfc(&attachment.name));

    let mut workbook = JsonObject::new();
    workbook.insert("formatVersion".into(), json!(row.format_version));
    workbook.insert("workbookId".into(), json!(row.workbook_id));
    if let Some(name) = &row.name {
        workbook.insert("name".into(), json!(name));
    }
    let mut connection_values = Vec::with_capacity(connections.len());
    for connection in &connections {
        let mut object = JsonObject::new();
        object.insert("connectionId".into(), json!(connection.connection_id));
        object.insert("params".into(), parse_json(&connection.params, error_prefix, WorkbookTableName::Connections)?);
        if let Some(name) = &connection.name {
            object.insert("name".into(), json!(name));
        }
        connection_values.push(Value::Object(object));
    }
    workbook.insert("connections".into(), Value::Array(connection_values));
    workbook.insert(
        "scripts".into(),
        Value::Array(scripts.iter().map(|s| json!({ "name": s.name, "connectionId": s.connection_id })).collect()),
    );
    workbook
        .insert("attachments".into(), Value::Array(attachments.iter().map(|a| json!({ "name": a.name })).collect()));
    workbook.insert("metadata".into(), parse_json(&row.metadata, error_prefix, WorkbookTableName::Versions)?);

    // The workbook file and the catalogs are migrated in memory, like the top-level files of an archive
    let mut folder = MigrationFolder::new([(STORAGE_WORKBOOK_FILE.to_string(), to_text(&Value::Object(workbook)))]);
    for (connection_id, catalog) in catalog_structures(tables) {
        if !catalog.tables.is_empty() {
            folder.write(
                bundle_catalog_path(&connection_id, STORAGE_CATALOG_RELATIONS),
                catalog_tables_sql(&catalog.tables),
            );
        }
        if !catalog.functions.is_empty() {
            folder.write(
                bundle_catalog_path(&connection_id, STORAGE_CATALOG_FUNCTIONS),
                catalog_functions_sql(&catalog.functions),
            );
        }
    }
    let head = read_workbook_bundle_head(&mut folder, error_prefix)?;
    let script_data: Vec<ScriptData> =
        scripts.iter().map(|script| ScriptData::new(script.name.clone(), script.text.clone())).collect();
    // The data tables by name, the first of a name wins
    let mut data_files: HashMap<&str, &DataTableFile<B>> = HashMap::with_capacity(tables.data.len());
    for (name, file) in &tables.data {
        data_files.entry(name.as_str()).or_insert(file);
    }
    let data_file = |table_name: &str| data_files.get(table_name).copied();
    let data: Vec<DataFileData<B>> = attachments
        .iter()
        .filter_map(|attachment| {
            data_file(&attachment.table_name)
                .map(|file| DataFileData { name: attachment.name.clone(), bytes: file.bytes.clone() })
        })
        .collect();
    let results: Vec<WorkbookBundleResult<B>> = tables
        .results
        .iter()
        .filter_map(|result| {
            data_file(&result.table_name).map(|file| WorkbookBundleResult {
                key: result.cache_key.clone(),
                script: result.script_name.clone(),
                bytes: file.bytes.clone(),
                crc32: file.crc32,
            })
        })
        .collect();
    let mut bundle = assemble_workbook_bundle(head.workbook, head.catalogs, script_data, data);
    bundle.results = results;
    check_workbook_bundle(&bundle, error_prefix)?;
    Ok(bundle)
}

/// The tables and functions of the catalogs of the connections, by connection in the order of their ids
fn catalog_structures<B>(tables: &WorkbookTables<B>) -> Vec<(String, CatalogStructure)> {
    let mut catalogs: Groups<String, CatalogStructure> = Groups::new();
    // The columns of the tables and the params of the functions by id, read once
    let mut columns_of: HashMap<i32, Vec<&CatalogColumnRow>> = HashMap::new();
    for column in &tables.catalog_columns {
        columns_of.entry(column.table_id).or_default().push(column);
    }
    let mut params_of: HashMap<i32, Vec<&CatalogFunctionParamRow>> = HashMap::new();
    for param in &tables.catalog_function_params {
        params_of.entry(param.function_id).or_default().push(param);
    }
    let mut table_rows: Vec<&CatalogTableRow> = tables.catalog_tables.iter().collect();
    table_rows.sort_by_key(|row| row.table_id);
    for row in table_rows {
        let mut columns: Vec<&CatalogColumnRow> = columns_of.get(&row.table_id).cloned().unwrap_or_default();
        columns.sort_by_key(|column| column.position);
        let table = CatalogTable {
            database_name: row.database_name.clone(),
            schema_name: row.schema_name.clone(),
            table_name: row.table_name.clone(),
            columns: columns
                .into_iter()
                .enumerate()
                .map(|(ordinal_position, column)| ColumnMetadata {
                    name: column.column_name.clone(),
                    ordinal_position: ordinal_position as i64,
                    data_type: column.column_type.clone(),
                })
                .collect(),
        };
        catalogs.entry(&row.connection_id).tables.push(table);
    }
    let mut function_rows: Vec<&CatalogFunctionRow> = tables.catalog_functions.iter().collect();
    function_rows.sort_by_key(|row| row.function_id);
    for row in function_rows {
        let mut params: Vec<&CatalogFunctionParamRow> = params_of.get(&row.function_id).cloned().unwrap_or_default();
        params.sort_by_key(|param| param.position);
        let function = CatalogFunction {
            database_name: row.database_name.clone(),
            schema_name: row.schema_name.clone(),
            function_name: row.function_name.clone(),
            is_aggregate: row.is_aggregate,
            return_type: row.return_type.clone(),
            params: params
                .into_iter()
                .map(|param| CatalogFunctionParam {
                    name: param.param_name.clone(),
                    param_type: param.param_type.clone(),
                })
                .collect(),
        };
        catalogs.entry(&row.connection_id).functions.push(function);
    }
    catalogs.into_entries()
}
