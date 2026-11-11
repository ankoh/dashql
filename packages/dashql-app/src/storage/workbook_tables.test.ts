import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { WorkbookBundle } from './workbook_bundle.js';
import {
    ATTACHMENTS_TABLE,
    CATALOG_COLUMNS_TABLE,
    CATALOG_FUNCTION_PARAMS_TABLE,
    CATALOG_FUNCTIONS_TABLE,
    CATALOG_TABLES_TABLE,
    CONNECTIONS_TABLE,
    isDataTableName,
    RESULTS_TABLE,
    SCRIPTS_TABLE,
    WORKBOOK_TABLE,
    WORKBOOK_TABLE_NAMES,
    workbookBundleToTables,
    workbookTableFromArrow,
    workbookTablesToBundle,
    workbookTableToArrow,
} from './workbook_tables.js';
import { TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from './workbook_test_backend.js';
import { generateCatalogFunctionsSQL, generateCatalogRelationsSQL, parseCatalogSql } from '../connections/catalog/catalog_structure.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});
const parse = (sql: string) => parseCatalogSql(dql, sql);

/// The catalog files of the test connection as the app renders them
const RELATIONS = generateCatalogRelationsSQL([
    { databaseName: 'hyper', schemaName: 'public', tableName: 'orders', columns: [
        { name: 'id', ordinalPosition: 0, dataType: 'integer' },
        { name: 'note', ordinalPosition: 1, dataType: 'text' },
    ] },
    { databaseName: 'hyper', schemaName: 'public', tableName: 'empty', columns: [] },
]);
const FUNCTIONS = generateCatalogFunctionsSQL([
    { databaseName: 'hyper', schemaName: 'pg_catalog', functionName: 'abs', isAggregate: false, returnType: 'any', params: [] },
    { databaseName: 'hyper', schemaName: 'public', functionName: 'scale', isAggregate: false, returnType: 'bigint', params: [
        { name: 'value', type: 'integer' }, { name: 'factor', type: 'integer' },
    ] },
    { databaseName: 'hyper', schemaName: 'public', functionName: 'scale', isAggregate: false, returnType: 'bigint', params: [{ name: 'value', type: 'bigint' }] },
    { databaseName: 'hyper', schemaName: 'pg_catalog', functionName: 'any_value', isAggregate: true, returnType: 'any', params: [] },
]);

const OTHER_CONNECTION_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function testBundle(): WorkbookBundle {
    return {
        workbook: testWorkbook({
            name: 'Tables',
            connections: [
                { connectionId: TEST_CONNECTION_ID, params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } } as any, name: 'Local' },
                { connectionId: OTHER_CONNECTION_ID, params: { hyper: {} } as any },
            ],
            scripts: [
                { name: 'b.sql', connectionId: TEST_CONNECTION_ID },
                { name: 'a.sql', connectionId: OTHER_CONNECTION_ID },
            ],
            attachments: [{ name: 'd.parquet' }],
            metadata: { createdAt: '2026-11-10T10:00:00.000Z' },
        }),
        catalogs: [{ connectionId: TEST_CONNECTION_ID, relations: RELATIONS, functions: FUNCTIONS }],
        scripts: [{ name: 'b.sql', sql: 'select 1' }, { name: 'a.sql', sql: "select 'it''s'" }],
        data: [{ name: 'd.parquet', bytes: new Uint8Array([1, 2, 3]) }],
        results: [{ key: 'k1', bytes: new Blob([new Uint8Array([4, 5])]) }],
    };
}

describe('workbook tables', () => {
    it('round-trip a bundle through the rows', async () => {
        const bundle = testBundle();
        const tables = workbookBundleToTables(bundle, parse);
        expect(tables[WORKBOOK_TABLE]).toEqual([{
            workbook_id: TEST_WORKBOOK_ID,
            format_version: bundle.workbook.formatVersion,
            name: 'Tables',
            metadata: JSON.stringify(bundle.workbook.metadata),
        }]);
        expect(tables[SCRIPTS_TABLE].map(row => [row.position, row.name, row.connection_id])).toEqual([
            [0, 'b.sql', TEST_CONNECTION_ID],
            [1, 'a.sql', OTHER_CONNECTION_ID],
        ]);
        expect(tables[CATALOG_TABLES_TABLE].map(row => [row.table_id, row.connection_id, row.database_name, row.schema_name, row.table_name])).toEqual([
            [0, TEST_CONNECTION_ID, 'hyper', 'public', 'orders'],
            [1, TEST_CONNECTION_ID, 'hyper', 'public', 'empty'],
        ]);
        expect(tables[CATALOG_COLUMNS_TABLE].map(row => [row.table_id, row.position, row.column_name])).toEqual([
            [0, 0, 'id'],
            [0, 1, 'note'],
        ]);
        // The overloads of a function stay apart by their ids
        expect(tables[CATALOG_FUNCTIONS_TABLE].map(row => [row.function_id, row.function_name, row.is_aggregate, row.return_type])).toEqual([
            [0, 'abs', false, 'any'],
            [1, 'scale', false, 'bigint'],
            [2, 'scale', false, 'bigint'],
            [3, 'any_value', true, 'any'],
        ]);
        expect(tables[CATALOG_FUNCTION_PARAMS_TABLE].map(row => [row.function_id, row.position, row.param_name, row.param_type])).toEqual([
            [1, 0, 'value', 'integer'],
            [1, 1, 'factor', 'integer'],
            [2, 0, 'value', 'bigint'],
        ]);
        expect(tables[ATTACHMENTS_TABLE]).toHaveLength(1);
        expect(tables[RESULTS_TABLE]).toHaveLength(1);
        expect(isDataTableName(tables[ATTACHMENTS_TABLE][0].table_name)).toBe(true);
        expect(isDataTableName(tables[RESULTS_TABLE][0].table_name)).toBe(true);
        expect(tables.data.size).toBe(2);

        const read = await workbookTablesToBundle(tables);
        const { results, ...rest } = read;
        const { results: _, ...expected } = bundle;
        expect(rest).toEqual(expected);
        expect(results!.map(result => result.key)).toEqual(['k1']);
        expect(new Uint8Array(await results![0].bytes.arrayBuffer())).toEqual(new Uint8Array([4, 5]));
    });

    it('round-trip a workbook that only holds a connection', async () => {
        const bundle: WorkbookBundle = { workbook: testWorkbook(), catalogs: [], scripts: [], data: [] };
        expect(await workbookTablesToBundle(workbookBundleToTables(bundle, parse))).toEqual(bundle);
    });

    it('number the tables and functions of all connections, every connection reads back its own catalog', async () => {
        const other = generateCatalogRelationsSQL([
            { databaseName: 'other', schemaName: 'public', tableName: 'events', columns: [{ name: 'at', ordinalPosition: 0, dataType: 'text' }] },
        ]);
        const bundle: WorkbookBundle = {
            ...testBundle(),
            catalogs: [
                { connectionId: TEST_CONNECTION_ID, relations: RELATIONS, functions: FUNCTIONS },
                { connectionId: OTHER_CONNECTION_ID, relations: other, functions: FUNCTIONS },
            ],
        };
        const tables = workbookBundleToTables(bundle, parse);
        expect(tables[CATALOG_TABLES_TABLE].map(row => [row.table_id, row.connection_id, row.table_name])).toEqual([
            [0, TEST_CONNECTION_ID, 'orders'],
            [1, TEST_CONNECTION_ID, 'empty'],
            [2, OTHER_CONNECTION_ID, 'events'],
        ]);
        expect(tables[CATALOG_COLUMNS_TABLE].map(row => [row.table_id, row.column_name])).toEqual([[0, 'id'], [0, 'note'], [2, 'at']]);
        expect(tables[CATALOG_FUNCTIONS_TABLE].map(row => row.function_id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(new Set(tables[CATALOG_FUNCTION_PARAMS_TABLE].map(row => row.function_id))).toEqual(new Set([1, 2, 5, 6]));
        // The order of the rows doesn't matter, the ids and positions give it
        const shuffled = { ...tables };
        for (const name of [CATALOG_TABLES_TABLE, CATALOG_COLUMNS_TABLE, CATALOG_FUNCTIONS_TABLE, CATALOG_FUNCTION_PARAMS_TABLE] as const) {
            (shuffled[name] as object[]) = [...tables[name]].reverse();
        }
        const { results: _, ...read } = await workbookTablesToBundle(shuffled);
        const { results: __, ...expected } = bundle;
        expect(read).toEqual(expected);
    });

    it('reject tables without exactly one workbook', async () => {
        const tables = workbookBundleToTables(testBundle(), parse);
        await expect(workbookTablesToBundle({ ...tables, [WORKBOOK_TABLE]: [] })).rejects.toThrow('expected one workbook, found 0');
        const [row] = tables[WORKBOOK_TABLE];
        await expect(workbookTablesToBundle({ ...tables, [WORKBOOK_TABLE]: [row, row] })).rejects.toThrow('expected one workbook, found 2');
    });

    it('leave out attachments whose table is missing', async () => {
        const tables = workbookBundleToTables(testBundle(), parse);
        tables.data.clear();
        const bundle = await workbookTablesToBundle(tables);
        expect(bundle.data).toEqual([]);
        expect(bundle.workbook.attachments).toEqual([]);
        expect(bundle.results).toBeUndefined();
    });

    it('reject rows with invalid json', async () => {
        const tables = workbookBundleToTables(testBundle(), parse);
        tables[CONNECTIONS_TABLE][0].params = '{';
        await expect(workbookTablesToBundle(tables)).rejects.toThrow('invalid JSON in workbook_connections');
    });

    it('round-trip the rows through arrow', () => {
        const tables = workbookBundleToTables(testBundle(), parse);
        for (const name of WORKBOOK_TABLE_NAMES) {
            const table = workbookTableToArrow(name, tables[name]);
            expect(table.numRows).toBe(tables[name].length);
            expect(workbookTableFromArrow(name, table)).toEqual(tables[name]);
        }
    });

    it('reject arrow tables that miss a column', () => {
        const table = workbookTableToArrow(SCRIPTS_TABLE, []).select(['position']);
        expect(() => workbookTableFromArrow(SCRIPTS_TABLE, table)).toThrow('has no column name');
    });
});
