import * as flatbuffers from 'flatbuffers';
import { describe, expect, it, vi } from 'vitest';
import * as buffers from '@ankoh/dashql-core/buffers';
import type { QueryExecutor } from '../query_executor.js';
import { informationSchemaColumnsQuery, updateInformationSchemaCatalog, updateInformationSchemaRelations } from './catalog_query_information_schema.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

describe('information_schema batch refresh', () => {
    it('queries nothing when no catalog is configured', async () => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({}))]);
        await expect(updateInformationSchemaCatalog('session', vi.fn(), 7, [], executor,
            {} as any, 1)).rejects.toThrow('no catalogs to read the information_schema of');
        expect(executor).not.toHaveBeenCalled();
    });

    it('reads the information_schema of every catalog', () => {
        expect(informationSchemaColumnsQuery([
            { catalog: 'hive', schemas: ['sales', "o'neil"] },
            { catalog: 'my"lake', schemas: [] },
        ])).toBe(`SELECT
    table_catalog,
    table_schema,
    table_name,
    column_name,
    ordinal_position,
    data_type
FROM "hive".information_schema.columns
WHERE table_schema IN ('sales', 'o''neil')
UNION ALL
SELECT
    table_catalog,
    table_schema,
    table_name,
    column_name,
    ordinal_position,
    data_type
FROM "my""lake".information_schema.columns`);
    });

    it('rejects an empty metadata result instead of reporting a successful refresh', async () => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({}))]);
        await expect(updateInformationSchemaCatalog('session', vi.fn(), 7, [{ catalog: 'catalog', schemas: [] }], executor,
            {} as any, 1)).rejects.toThrow('information_schema returned no catalog relations');
    });

    /// The tables of the descriptor that a refresh published
    const publishedTables = (catalog: { replaceDescriptor: ReturnType<typeof vi.fn> }) => {
        const bytes = catalog.replaceDescriptor.mock.calls[0][2] as Uint8Array;
        return buffers.catalog.CatalogDescriptor.getRootAsCatalogDescriptor(new flatbuffers.ByteBuffer(bytes)).unpack().tables;
    };

    it('orders the columns by bigint ordinal positions', async () => {
        const catalog = { replaceDescriptor: vi.fn() };
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({
            table_catalog: ['db', 'db'], table_schema: ['public', 'public'], table_name: ['items', 'items'],
            column_name: ['name', 'id'], ordinal_position: [2n, 1n], data_type: ['varchar', 'bigint'],
        }))]);
        await updateInformationSchemaCatalog('connection', vi.fn(), 1, [{ catalog: 'db', schemas: [] }], executor, catalog as any, 7);
        expect(publishedTables(catalog)[0].tableColumns.map(column => column.columnName)).toEqual(['id', 'name']);
    });

    it.each(['success', 'aborted'])('publishes only a current response: %s', async outcome => {
        const catalog = { replaceDescriptor: vi.fn() };
        const abort = new AbortController();
        const executor = vi.fn<QueryExecutor>(() => {
            if (outcome === 'aborted') abort.abort();
            return [1, Promise.resolve(tableFromArrays({
                table_catalog: ['db'], table_schema: ['public'], table_name: ['items'], column_name: ['id'], ordinal_position: [1], data_type: ['bigint'],
            }))];
        });
        const refresh = updateInformationSchemaCatalog('connection', vi.fn(), 1, [{ catalog: 'db', schemas: [] }], executor,
            catalog as any, 7, { abortSignal: abort.signal });
        if (outcome === 'success') {
            await refresh;
            expect(catalog.replaceDescriptor).toHaveBeenCalledExactlyOnceWith(7, expect.any(Number), expect.any(Uint8Array));
            expect(publishedTables(catalog)[0].tableName?.tableName).toBe('items');
        } else {
            await expect(refresh).rejects.toThrow();
            expect(catalog.replaceDescriptor).not.toHaveBeenCalled();
        }
        expect(executor.mock.calls[0][1].abortSignal).toBe(abort.signal);
    });

    it('asks about relations in the catalogs they belong to and updates only them', async () => {
        const catalog = { replaceTables: vi.fn() };
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({
            table_catalog: ['hive'], table_schema: ['sales'], table_name: ['orders'], column_name: ['id'], ordinal_position: [1], data_type: ['bigint'],
        }))]);
        const orders = { databaseName: 'hive', schemaName: 'sales', tableName: 'orders' };
        const gone = { databaseName: 'hive', schemaName: 'sales', tableName: 'gone' };
        await updateInformationSchemaRelations('connection', vi.fn(), 1, [orders, gone], executor, catalog as any, 7);
        expect(executor.mock.calls[0][1].query).toContain(`FROM "hive".information_schema.columns
WHERE table_schema <> 'information_schema' AND ((table_schema = 'sales' AND table_name = 'orders') OR (table_schema = 'sales' AND table_name = 'gone'))`);
        const update = catalog.replaceTables.mock.calls[0][2];
        expect(update.relations.map((r: buffers.analyzer.QualifiedTableNameT) => r.tableName)).toEqual(['orders', 'gone']);
        expect(update.tables.map((t: buffers.analyzer.TableT) => t.tableName?.tableName)).toEqual(['orders']);
    });
});
