import * as arrow from 'apache-arrow';

import type { WorkbookData } from '@akohn/dashql/platform/storage/storage_backend';
import {
    ATTACHMENT_TABLE_PREFIX,
    emptyWorkbookTables,
    newDataTableName,
    RESULT_TABLE_PREFIX,
    type CatalogColumnRow,
    type CatalogFunctionParamRow,
    type CatalogFunctionRow,
    type CatalogTableRow,
    type WorkbookTableName,
    type WorkbookTables,
} from '@akohn/dashql/platform/storage/workbook_tables';

import type { CloudWorkbookTables } from './cloud_store.js';

// The workbook tables of the tests of the clouds, written as the runtime exports them (`workbook_bundle_to_tables` of
// the crate): the metadata of the workbook and the params of the connections as JSON text, the scripts in the order
// of the workbook file, a data table of a fresh name for every attachment and result.

/// The catalog rows of a workbook of the tests, the ids count across the connections
export interface TestCatalogRows {
    tables?: CatalogTableRow[];
    columns?: CatalogColumnRow[];
    functions?: CatalogFunctionRow[];
    params?: CatalogFunctionParamRow[];
}

/// What the workbook tables of a test hold
export interface TestWorkbookTables {
    /// The workbook file, its scripts name the texts of `scripts`
    workbook: WorkbookData;
    /// The texts of the scripts by file name
    scripts: Record<string, string>;
    catalog?: TestCatalogRows;
    /// The Parquet files of the attachments by name
    attachments?: { name: string; bytes: Blob }[];
    /// The Parquet files of cached results by key
    results?: { key: string; bytes: Blob }[];
}

/// The workbook tables of a workbook of a test
export function testWorkbookTables(spec: TestWorkbookTables): WorkbookTables {
    const tables = emptyWorkbookTables();
    const { workbook } = spec;
    tables.workbook.push({ workbook_id: workbook.workbookId, format_version: workbook.formatVersion, name: workbook.name ?? null, metadata: JSON.stringify(workbook.metadata) });
    workbook.connections.forEach((connection, position) => tables.workbook_connections.push({
        position,
        connection_id: connection.connectionId,
        name: connection.name ?? null,
        params: JSON.stringify(connection.params),
    }));
    workbook.scripts.forEach((script, position) => {
        const text = spec.scripts[script.name];
        if (text != null) tables.workbook_scripts.push({ position, name: script.name, connection_id: script.connectionId, text });
    });
    tables.connection_catalog_tables.push(...spec.catalog?.tables ?? []);
    tables.connection_catalog_columns.push(...spec.catalog?.columns ?? []);
    tables.connection_catalog_functions.push(...spec.catalog?.functions ?? []);
    tables.connection_catalog_function_params.push(...spec.catalog?.params ?? []);
    (spec.attachments ?? []).forEach((file, position) => {
        const tableName = newDataTableName(ATTACHMENT_TABLE_PREFIX);
        tables.workbook_attachments.push({ position, name: file.name, table_name: tableName });
        tables.data.set(tableName, { bytes: file.bytes });
    });
    for (const result of spec.results ?? []) {
        const tableName = newDataTableName(RESULT_TABLE_PREFIX);
        tables.workbook_results.push({ cache_key: result.key, table_name: tableName });
        tables.data.set(tableName, { bytes: result.bytes });
    }
    return tables;
}

/// The rows of a workbook table that a cloud returned, as plain objects. A table that the cloud lacks has no rows.
export function cloudRows(tables: CloudWorkbookTables, name: WorkbookTableName): Record<string, unknown>[] {
    const ipc = tables.rows[name];
    if (ipc == null) return [];
    return arrow.tableFromIPC(ipc).toArray().map(row => ({ ...row.toJSON() }));
}
