import * as core from '../../core/index.js';

// The tables of a version of a workbook: in a `.dashql` file as `<table>.parquet`, in the cloud as rows of tables of the
// same names and columns, merged across the versions of all workbooks. Every row starts with the key of its version,
// `(workbook_id, version_id)`. A table is named after what its rows belong to, the workbook or a connection. See
// docs/design/workbook_tables.md.
//
// The rows are a module of the workbook format of the core (`workbook_format::tables`). The runtime turns workbooks into
// rows and back when it imports and exports them, a cloud writes and reads the rows of the export and the import. The
// Parquet files stay with the embedded Hyper, the bytes of the data tables with the host.

/// The versions of the workbook, one row per version: the workbook file of the version
export const VERSIONS_TABLE = 'workbook_versions';
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

/// The workbook tables, the versions first
export const WORKBOOK_TABLE_NAMES = [
    VERSIONS_TABLE,
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
export type WorkbookTableColumnType = core.WorkbookTableColumnType;

/// A column of a workbook table
export type WorkbookTableColumn = core.WorkbookTableColumn;

/// The columns of a workbook table, as the core declares them
export function workbookTableColumns(instance: core.DashQL, name: WorkbookTableName): WorkbookTableColumn[] {
    const table = instance.workbookTables().find(table => table.name === name);
    if (table == null) throw new Error(`Unknown workbook table ${name}`);
    return table.columns;
}

/// The key of a version, the first columns of every row
export interface VersionKeyColumns {
    workbook_id: string;
    version_id: string;
}

/// A version of the workbook, the workbook file without its lists
export interface VersionRow extends VersionKeyColumns {
    format_version: number;
    name: string | null;
    /// The metadata of the workbook as JSON
    metadata: string;
}

export interface ConnectionRow extends VersionKeyColumns {
    position: number;
    connection_id: string;
    name: string | null;
    /// The connection params as JSON, sanitized for sharing
    params: string;
}

export interface ScriptRow extends VersionKeyColumns {
    position: number;
    name: string;
    connection_id: string;
    text: string;
}

/// A table of the catalog of a connection
export interface CatalogTableRow extends VersionKeyColumns {
    /// Unique among the tables of the version, the tables of a connection are in the order of their ids
    table_id: number;
    connection_id: string;
    /// Empty if the declaration names none
    database_name: string;
    /// Empty if the declaration names none
    schema_name: string;
    table_name: string;
}

/// A column of a table of a catalog
export interface CatalogColumnRow extends VersionKeyColumns {
    /// The table of the column
    table_id: number;
    position: number;
    column_name: string;
    column_type: string | null;
}

/// A function of the catalog of a connection
export interface CatalogFunctionRow extends VersionKeyColumns {
    /// Unique among the functions of the version, the functions of a connection are in the order of their ids
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
export interface CatalogFunctionParamRow extends VersionKeyColumns {
    /// The function of the parameter
    function_id: number;
    position: number;
    param_name: string | null;
    param_type: string | null;
}

export interface AttachmentRow extends VersionKeyColumns {
    position: number;
    name: string;
    table_name: string;
}

export interface ResultRow extends VersionKeyColumns {
    /// The key in the name of the file of the stored result
    cache_key: string;
    table_name: string;
    /// The file name of the script, null in the archives of earlier versions, which name only the key
    script_name: string | null;
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
    /// One row, the tables hold one version
    [VERSIONS_TABLE]: VersionRow[];
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
        [VERSIONS_TABLE]: [],
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
