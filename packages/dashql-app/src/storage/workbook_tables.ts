import * as arrow from 'apache-arrow';

import type { DataFileData, WorkbookData, ScriptData } from './storage_backend.js';
import { STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS, STORAGE_WORKBOOK_FILE } from './storage_backend.js';
import { MemoryFolder } from './migration/migration_folder.js';
import {
    assembleWorkbookBundle,
    bundleCatalogPath,
    readWorkbookBundleHead,
    type WorkbookBundle,
    type WorkbookBundleResult,
} from './workbook_bundle.js';
import { boolVector, intVector, utf8Vector } from '../utils/arrow_vectors.js';
import type { CatalogTable } from '../connections/catalog/catalog_sql_generator.js';
import {
    generateCatalogFunctionsSQL,
    generateCatalogRelationsSQL,
    type CatalogFunction,
    type CatalogStructure,
} from '../connections/catalog/catalog_structure.js';

// The tables of one workbook, in a `.dashql` file as `<table>.parquet`. A table is named after what its rows belong to,
// the workbook or a connection. See docs/design/workbook_tables.md.

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

/// The type of a column of a workbook table
export type WorkbookTableColumnType = 'text' | 'integer' | 'boolean';

/// A column of a workbook table
export interface WorkbookTableColumn {
    name: string;
    type: WorkbookTableColumnType;
    nullable: boolean;
}

const text = (name: string, nullable = false): WorkbookTableColumn => ({ name, type: 'text', nullable });
const integer = (name: string): WorkbookTableColumn => ({ name, type: 'integer', nullable: false });
const boolean = (name: string): WorkbookTableColumn => ({ name, type: 'boolean', nullable: false });

/// The columns of the workbook tables by table name
export const WORKBOOK_TABLE_COLUMNS = {
    [WORKBOOK_TABLE]: [text('workbook_id'), integer('format_version'), text('name', true), text('metadata')],
    [CONNECTIONS_TABLE]: [integer('position'), text('connection_id'), text('name', true), text('params')],
    [SCRIPTS_TABLE]: [integer('position'), text('name'), text('connection_id'), text('text')],
    [CATALOG_TABLES_TABLE]: [integer('table_id'), text('connection_id'), text('database_name'), text('schema_name'), text('table_name')],
    [CATALOG_COLUMNS_TABLE]: [integer('table_id'), integer('position'), text('column_name'), text('column_type', true)],
    [CATALOG_FUNCTIONS_TABLE]: [integer('function_id'), text('connection_id'), text('database_name'), text('schema_name'), text('function_name'), boolean('is_aggregate'), text('return_type', true)],
    [CATALOG_FUNCTION_PARAMS_TABLE]: [integer('function_id'), integer('position'), text('param_name', true), text('param_type', true)],
    [ATTACHMENTS_TABLE]: [integer('position'), text('name'), text('table_name')],
    [RESULTS_TABLE]: [text('cache_key'), text('table_name')],
} as const satisfies Record<string, WorkbookTableColumn[]>;

/// The name of a workbook table
export type WorkbookTableName = keyof typeof WORKBOOK_TABLE_COLUMNS;

/// The workbook tables, the workbook first
export const WORKBOOK_TABLE_NAMES: WorkbookTableName[] = [
    WORKBOOK_TABLE,
    CONNECTIONS_TABLE,
    SCRIPTS_TABLE,
    CATALOG_TABLES_TABLE,
    CATALOG_COLUMNS_TABLE,
    CATALOG_FUNCTIONS_TABLE,
    CATALOG_FUNCTION_PARAMS_TABLE,
    ATTACHMENTS_TABLE,
    RESULTS_TABLE,
];

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

/// Is a name the name of a workbook table?
export function isWorkbookTableName(name: string): name is WorkbookTableName {
    return Object.prototype.hasOwnProperty.call(WORKBOOK_TABLE_COLUMNS, name);
}

/// Read the SQL of a catalog file into its tables and functions, see `parseCatalogSql`
export type CatalogParser = (sql: string) => CatalogStructure;

/// The rows of a bundle.
/// The connection params are written as the bundle holds them, an export sanitizes them first. The catalog files of the
/// connections are read into their tables and functions with `parseCatalog`.
export function workbookBundleToTables(bundle: WorkbookBundle, parseCatalog: CatalogParser): WorkbookTables {
    const tables = emptyWorkbookTables();
    const { workbook } = bundle;
    tables[WORKBOOK_TABLE].push({
        workbook_id: workbook.workbookId,
        format_version: workbook.formatVersion,
        name: workbook.name ?? null,
        metadata: JSON.stringify(workbook.metadata),
    });
    workbook.connections.forEach((connection, position) => tables[CONNECTIONS_TABLE].push({
        position,
        connection_id: connection.connectionId,
        name: connection.name ?? null,
        params: JSON.stringify(connection.params),
    }));
    const scriptTexts = new Map(bundle.scripts.map(script => [script.name, script.sql]));
    workbook.scripts.forEach((script, position) => {
        const sql = scriptTexts.get(script.name);
        if (sql == null) return;
        tables[SCRIPTS_TABLE].push({ position, name: script.name, connection_id: script.connectionId, text: sql });
    });
    // The ids count the tables and the functions of all connections, in the order of their declarations
    for (const catalog of bundle.catalogs) {
        const connection_id = catalog.connectionId;
        const relations = catalog.relations?.trim() ? parseCatalog(catalog.relations).tables : [];
        const functions = catalog.functions?.trim() ? parseCatalog(catalog.functions).functions : [];
        for (const table of relations) {
            const table_id = tables[CATALOG_TABLES_TABLE].length;
            tables[CATALOG_TABLES_TABLE].push({
                table_id, connection_id, database_name: table.databaseName, schema_name: table.schemaName, table_name: table.tableName,
            });
            [...table.columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition).forEach((column, position) => {
                tables[CATALOG_COLUMNS_TABLE].push({ table_id, position, column_name: column.name, column_type: column.dataType ?? null });
            });
        }
        for (const fn of functions) {
            const function_id = tables[CATALOG_FUNCTIONS_TABLE].length;
            tables[CATALOG_FUNCTIONS_TABLE].push({
                function_id, connection_id, database_name: fn.databaseName, schema_name: fn.schemaName, function_name: fn.functionName,
                is_aggregate: fn.isAggregate, return_type: fn.returnType,
            });
            fn.params.forEach((param, position) => {
                tables[CATALOG_FUNCTION_PARAMS_TABLE].push({ function_id, position, param_name: param.name, param_type: param.type });
            });
        }
    }
    (bundle.data ?? []).forEach((file, position) => {
        const tableName = newDataTableName(ATTACHMENT_TABLE_PREFIX);
        tables[ATTACHMENTS_TABLE].push({ position, name: file.name, table_name: tableName });
        tables.data.set(tableName, { bytes: new Blob([file.bytes as Uint8Array<ArrayBuffer>]) });
    });
    for (const result of bundle.results ?? []) {
        const tableName = newDataTableName(RESULT_TABLE_PREFIX);
        tables[RESULTS_TABLE].push({ cache_key: result.key, table_name: tableName });
        tables.data.set(tableName, { bytes: result.bytes, ...(result.crc32 == null ? {} : { crc32: result.crc32 }) });
    }
    return tables;
}

/// Read the bundle of the workbook of a set of tables.
/// The workbook file of the bundle is assembled from the rows and migrated like a workbook folder. A data table that
/// the tables don't carry leaves its attachment or result out.
export async function workbookTablesToBundle(tables: WorkbookTables, errorPrefix: string = 'Invalid workbook tables'): Promise<WorkbookBundle> {
    if (tables[WORKBOOK_TABLE].length !== 1) {
        throw new Error(`${errorPrefix}: expected one workbook, found ${tables[WORKBOOK_TABLE].length}`);
    }
    const [row] = tables[WORKBOOK_TABLE];
    const byPosition = <R extends { position: number }>(rows: readonly R[]) => [...rows].sort((a, b) => a.position - b.position);
    const connections = byPosition(tables[CONNECTIONS_TABLE]);
    const scripts = byPosition(tables[SCRIPTS_TABLE]);
    const attachments = byPosition(tables[ATTACHMENTS_TABLE]);
    const workbook = {
        formatVersion: row.format_version,
        workbookId: row.workbook_id,
        ...(row.name == null ? {} : { name: row.name }),
        connections: connections.map(connection => ({
            connectionId: connection.connection_id,
            params: parseJson(connection.params, errorPrefix, CONNECTIONS_TABLE),
            ...(connection.name == null ? {} : { name: connection.name }),
        })),
        scripts: scripts.map(script => ({ name: script.name, connectionId: script.connection_id })),
        attachments: attachments.map(attachment => ({ name: attachment.name })),
        metadata: parseJson(row.metadata, errorPrefix, WORKBOOK_TABLE),
    } as WorkbookData;
    // The workbook file and the catalogs are migrated in memory, like the top-level files of an archive
    const folder = new MemoryFolder([[STORAGE_WORKBOOK_FILE, JSON.stringify(workbook)]]);
    for (const [connectionId, catalog] of catalogStructures(
        tables[CATALOG_TABLES_TABLE], tables[CATALOG_COLUMNS_TABLE],
        tables[CATALOG_FUNCTIONS_TABLE], tables[CATALOG_FUNCTION_PARAMS_TABLE],
    )) {
        if (catalog.tables.length > 0) {
            await folder.writeText(bundleCatalogPath(connectionId, STORAGE_CATALOG_RELATIONS), generateCatalogRelationsSQL(catalog.tables));
        }
        if (catalog.functions.length > 0) {
            await folder.writeText(bundleCatalogPath(connectionId, STORAGE_CATALOG_FUNCTIONS), generateCatalogFunctionsSQL(catalog.functions));
        }
    }
    const head = await readWorkbookBundleHead(folder, errorPrefix);
    const scriptData: ScriptData[] = scripts.map(script => ({ name: script.name, sql: script.text }));
    const data: DataFileData[] = [];
    for (const attachment of attachments) {
        const file = tables.data.get(attachment.table_name);
        if (file == null) continue;
        data.push({ name: attachment.name, bytes: new Uint8Array(await file.bytes.arrayBuffer()) });
    }
    const results: WorkbookBundleResult[] = tables[RESULTS_TABLE].flatMap(result => {
        const file = tables.data.get(result.table_name);
        return file == null ? [] : [{ key: result.cache_key, ...file }];
    });
    const bundle = assembleWorkbookBundle(head, scriptData, data);
    return results.length > 0 ? { ...bundle, results } : bundle;
}

/// The tables and functions of the catalogs of the connections, by connection
function catalogStructures(
    tableRows: readonly CatalogTableRow[],
    columnRows: readonly CatalogColumnRow[],
    functionRows: readonly CatalogFunctionRow[],
    paramRows: readonly CatalogFunctionParamRow[],
): Map<string, CatalogStructure> {
    const catalogs = new Map<string, CatalogStructure>();
    const catalogOf = (connectionId: string) => {
        let catalog = catalogs.get(connectionId);
        if (catalog == null) {
            catalog = { tables: [], functions: [] };
            catalogs.set(connectionId, catalog);
        }
        return catalog;
    };
    const byPosition = <R extends { position: number }>(rows: readonly R[]) => [...rows].sort((a, b) => a.position - b.position);
    const columnsOf = groupBy(columnRows, column => column.table_id);
    const paramsOf = groupBy(paramRows, param => param.function_id);
    for (const row of [...tableRows].sort((a, b) => a.table_id - b.table_id)) {
        const columns = byPosition(columnsOf.get(row.table_id) ?? []);
        const table: CatalogTable = {
            databaseName: row.database_name,
            schemaName: row.schema_name,
            tableName: row.table_name,
            columns: columns.map((column, ordinalPosition) => ({ name: column.column_name, ordinalPosition, dataType: column.column_type })),
        };
        catalogOf(row.connection_id).tables.push(table);
    }
    for (const row of [...functionRows].sort((a, b) => a.function_id - b.function_id)) {
        const params = byPosition(paramsOf.get(row.function_id) ?? []);
        const fn: CatalogFunction = {
            databaseName: row.database_name,
            schemaName: row.schema_name,
            functionName: row.function_name,
            isAggregate: row.is_aggregate,
            returnType: row.return_type,
            params: params.map(param => ({ name: param.param_name, type: param.param_type })),
        };
        catalogOf(row.connection_id).functions.push(fn);
    }
    return catalogs;
}

/// The rows by a key
function groupBy<R, K>(rows: readonly R[], key: (row: R) => K): Map<K, R[]> {
    const groups = new Map<K, R[]>();
    for (const row of rows) {
        const group = groups.get(key(row));
        if (group == null) groups.set(key(row), [row]);
        else group.push(row);
    }
    return groups;
}

function parseJson(value: string, errorPrefix: string, table: string): any {
    try {
        return JSON.parse(value);
    } catch {
        throw new Error(`${errorPrefix}: invalid JSON in ${table}`);
    }
}

/// The Arrow table of the rows of a workbook table, the columns follow `WORKBOOK_TABLE_COLUMNS`
export function workbookTableToArrow(name: WorkbookTableName, rows: readonly object[]): arrow.Table {
    const columns: Record<string, arrow.Vector> = {};
    for (const column of WORKBOOK_TABLE_COLUMNS[name]) {
        const values = rows.map(row => (row as Record<string, unknown>)[column.name]);
        switch (column.type) {
            case 'text':
                columns[column.name] = utf8Vector(values as Array<string | null>);
                break;
            case 'integer':
                columns[column.name] = intVector(new arrow.Int32(), values as number[]);
                break;
            case 'boolean':
                columns[column.name] = boolVector(values as boolean[]);
                break;
        }
    }
    return new arrow.Table(columns);
}

/// The rows of an Arrow table of a workbook table. Missing columns of nullable fields read as null, other missing
/// columns fail.
export function workbookTableFromArrow<N extends WorkbookTableName>(name: N, table: arrow.Table): WorkbookTables[N] {
    const vectors = WORKBOOK_TABLE_COLUMNS[name].map(column => {
        const vector = table.getChild(column.name);
        if (vector == null && !column.nullable) {
            throw new Error(`Invalid workbook tables: ${name} has no column ${column.name}`);
        }
        return [column, vector] as const;
    });
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < table.numRows; ++i) {
        const row: Record<string, unknown> = {};
        for (const [column, vector] of vectors) {
            const value = vector?.get(i) ?? null;
            if (value == null && !column.nullable) {
                throw new Error(`Invalid workbook tables: ${name}.${column.name} is null`);
            }
            switch (column.type) {
                case 'text':
                    row[column.name] = value == null ? null : String(value);
                    break;
                case 'integer':
                    row[column.name] = Number(value);
                    break;
                case 'boolean':
                    row[column.name] = Boolean(value);
                    break;
            }
        }
        rows.push(row);
    }
    return rows as unknown as WorkbookTables[N];
}
