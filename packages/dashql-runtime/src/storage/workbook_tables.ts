import { workbookFormat } from './workbook_format.js';

// The tables of one workbook: in a `.dashql` file as `<table>.parquet`, in the cloud as rows of tables of the same
// names, merged across the versions of all workbooks. A table is named after what its rows belong to, the workbook or a
// connection. See docs/design/workbook_tables.md.
//
// The rows are a module of the workbook format of the core (`workbook_format::tables`). The runtime turns workbooks into
// rows and back when it imports and exports them, a cloud writes and reads the rows of the export and the import. The
// Parquet files stay with the embedded Hyper, the bytes of the data tables with the host.

/// The workbook, one row
export const WORKBOOK_TABLE = 'workbook';
/// The connections of the workbook
export const CONNECTIONS_TABLE = 'workbook_connections';
/// The scripts of the workbook
export const SCRIPTS_TABLE = 'workbook_scripts';
/// The tables of the catalogs of the connections
export const CATALOG_TABLES_TABLE = 'connection_catalog_tables';
/// The columns of the tables of the catalogs
export const CATALOG_COLUMNS_TABLE = 'connection_catalog_columns';
/// The functions of the catalogs of the connections
export const CATALOG_FUNCTIONS_TABLE = 'connection_catalog_functions';
/// The parameters of the functions of the catalogs
export const CATALOG_FUNCTION_PARAMS_TABLE = 'connection_catalog_function_params';
/// The attachments of the workbook, each names the table that holds its data
export const ATTACHMENTS_TABLE = 'workbook_attachments';
/// The cached query results of the workbook, each names the table that holds its data
export const RESULTS_TABLE = 'workbook_results';
/// The prefix of a table that holds the data of an attachment
export const ATTACHMENT_TABLE_PREFIX = 'workbook_attachment_';
/// The prefix of a table that holds a cached query result
export const RESULT_TABLE_PREFIX = 'workbook_result_';
/// The extension of a table in a `.dashql` file
export const TABLE_FILE_EXTENSION = '.parquet';

/// The workbook tables, the workbook first
export const WORKBOOK_TABLE_NAMES = [
    WORKBOOK_TABLE,
    CONNECTIONS_TABLE,
    SCRIPTS_TABLE,
    CATALOG_TABLES_TABLE,
    CATALOG_COLUMNS_TABLE,
    CATALOG_FUNCTIONS_TABLE,
    CATALOG_FUNCTION_PARAMS_TABLE,
    ATTACHMENTS_TABLE,
    RESULTS_TABLE,
] as const;

/// The name of a workbook table
export type WorkbookTableName = typeof WORKBOOK_TABLE_NAMES[number];

/// The type of a column of a workbook table
export type WorkbookTableColumnType = 'text' | 'integer' | 'boolean';

/// A column of a workbook table
export interface WorkbookTableColumn {
    name: string;
    type: WorkbookTableColumnType;
    nullable: boolean;
}

/// The columns of a workbook table, as the core declares them. Needs the core instantiated.
export function workbookTableColumns(name: WorkbookTableName): WorkbookTableColumn[] {
    const table = workbookFormat().constants().tables.find(table => table.name === name);
    if (table == null) throw new Error(`Unknown workbook table ${name}`);
    return table.columns;
}

export interface WorkbookRow {
    workbook_id: string;
    format_version: number;
    name: string | null;
    /// The metadata of the workbook as JSON
    metadata: string;
}

export interface ConnectionRow {
    position: number;
    connection_id: string;
    name: string | null;
    /// The connection params as JSON, sanitized for sharing
    params: string;
}

export interface ScriptRow {
    position: number;
    name: string;
    connection_id: string;
    text: string;
}

/// A table of the catalog of a connection
export interface CatalogTableRow {
    /// Unique among the tables of the workbook, the tables of a connection are in the order of their ids
    table_id: number;
    connection_id: string;
    /// Empty if the declaration names none
    database_name: string;
    /// Empty if the declaration names none
    schema_name: string;
    table_name: string;
}

/// A column of a table of a catalog
export interface CatalogColumnRow {
    /// The table of the column
    table_id: number;
    position: number;
    column_name: string;
    column_type: string | null;
}

/// A function of the catalog of a connection
export interface CatalogFunctionRow {
    /// Unique among the functions of the workbook, the functions of a connection are in the order of their ids
    function_id: number;
    connection_id: string;
    /// Empty if the declaration names none
    database_name: string;
    /// Empty if the declaration names none
    schema_name: string;
    function_name: string;
    is_aggregate: boolean;
    return_type: string | null;
}

/// A parameter of a function of a catalog
export interface CatalogFunctionParamRow {
    /// The function of the parameter
    function_id: number;
    position: number;
    param_name: string | null;
    param_type: string | null;
}

export interface AttachmentRow {
    position: number;
    name: string;
    table_name: string;
}

export interface ResultRow {
    cache_key: string;
    table_name: string;
}

/// The Parquet file of an attachment or a result table
export interface DataTableFile {
    /// The file, e.g. a slice of an archive that stays on disk until it is read
    bytes: Blob;
    /// The CRC-32 that an archive stores for the file, an import of a result checks it while it streams the file
    crc32?: number;
}

/// The rows of the workbook tables, and the data of the attachment and result tables as Parquet files.
export interface WorkbookTables {
    /// One row
    [WORKBOOK_TABLE]: WorkbookRow[];
    [CONNECTIONS_TABLE]: ConnectionRow[];
    [SCRIPTS_TABLE]: ScriptRow[];
    [CATALOG_TABLES_TABLE]: CatalogTableRow[];
    [CATALOG_COLUMNS_TABLE]: CatalogColumnRow[];
    [CATALOG_FUNCTIONS_TABLE]: CatalogFunctionRow[];
    [CATALOG_FUNCTION_PARAMS_TABLE]: CatalogFunctionParamRow[];
    [ATTACHMENTS_TABLE]: AttachmentRow[];
    [RESULTS_TABLE]: ResultRow[];
    /// The Parquet files of the attachment and result tables by table name
    data: Map<string, DataTableFile>;
}

/// Workbook tables without rows
export function emptyWorkbookTables(): WorkbookTables {
    return {
        [WORKBOOK_TABLE]: [],
        [CONNECTIONS_TABLE]: [],
        [SCRIPTS_TABLE]: [],
        [CATALOG_TABLES_TABLE]: [],
        [CATALOG_COLUMNS_TABLE]: [],
        [CATALOG_FUNCTIONS_TABLE]: [],
        [CATALOG_FUNCTION_PARAMS_TABLE]: [],
        [ATTACHMENTS_TABLE]: [],
        [RESULTS_TABLE]: [],
        data: new Map(),
    };
}

/// A fresh name of a table that holds the data of an attachment or a result
export function newDataTableName(prefix: typeof ATTACHMENT_TABLE_PREFIX | typeof RESULT_TABLE_PREFIX): string {
    return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`;
}

/// Is a name the name of a table that holds the data of an attachment or a result?
export function isDataTableName(name: string): boolean {
    return /^workbook_(attachment|result)_[0-9a-f]{32}$/.test(name);
}
