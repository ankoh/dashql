import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../core/index.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import type { EmbeddedConnection } from '../platform/embedded_database.js';
import { ConnectorType } from '../platform/connections/connector_info.js';
import { setupTestConnection } from './testing/connection_fixtures.js';
import { createRuntime, type Runtime } from './runtime.js';
import type { ConnectionParams } from '../platform/storage/storage_backend.js';
import { STORAGE_CATALOG_RELATIONS } from '../platform/storage/storage_backend.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { WorkbookTestRegistry } from '../platform/testing/workbook_test_backend.js';
import { EmbeddedDatabaseChannel } from '../platform/connections/embedded_database_channel.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// A relation name of the core as the test compares it
interface RelationName { databaseName: string; schemaName: string; tableName: string }
const readRelationName = (name: dashql.buffers.analyzer.QualifiedTableNameT): RelationName => ({
    databaseName: String(name.databaseName ?? ''),
    schemaName: String(name.schemaName ?? ''),
    tableName: String(name.tableName ?? ''),
});
const packRelationName = (relation: RelationName) =>
    new dashql.buffers.analyzer.QualifiedTableNameT(0, relation.databaseName, relation.schemaName, relation.tableName);

const CONNECTION = dashql.buffers.catalog.CatalogLayer.CONNECTION;

/// The way of a statement to the catalog, on a real embedded Hyper, through the catalog loader of the runtime
describe('the catalog of a connection follows statements', () => {
    let dql: dashql.DashQL;
    let connection: EmbeddedConnection;
    let runtime: Runtime;
    let catalog: dashql.DashQLCatalog;
    let relations: number;
    let queries: string[];
    let storage: WorkbookTestRegistry;
    /// The statements of the test, the other queries on the channel are the ones of the catalog loader
    const statements = new Set<string>();

    /// Wait until the catalog loader answered every relation that statements touched
    const settled = () => vi.waitFor(() => {
        const updates = runtime.connection('connection')!.catalogUpdates;
        expect([updates.touchedRelations, updates.tasksRunning]).toEqual([[], []]);
    }, { timeout: 4000 });
    /// Run a statement with the query executor of the runtime: it tells the connection about the relations that the
    /// statement touched, also after a failure, and the catalog loader asks the connection about them
    const execute = async (statement: string) => {
        statements.add(statement);
        const metadata = { queryType: dashql.QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
        const [, done] = runtime.execute('connection', { query: statement, metadata });
        try {
            await done;
        } finally {
            await settled();
        }
    };
    const run = async (statement: string) => {
        await execute(statement);
    };
    /// The relations as `schema.table(a, b)`
    const tables = () => (catalog.readDescriptor(relations)?.tables ?? [])
        .map(table => `${table.tableName?.schemaName}.${table.tableName?.tableName}(${table.tableColumns.map(column => column.columnName).join(', ')})`);
    /// A script that reads a table, what it resolves to
    const reads = (target: dashql.DashQLCatalog, text: string) => {
        const script = dql.createScript(target);
        script.replaceText(text);
        script.analyze();
        const reference = script.getAnalyzed().unpack().tableReferences[0];
        const resolved = reference?.resolvedTable != null;
        script.destroy();
        return resolved;
    };

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const database = await openTestHyperDB('catalog_updates_integration_test');
        connection = await database.connect();
        // A Hyper server that a restored catalog describes: the loader only asks about the relations of statements
        const params = { protocol: 'V3_GRPC', endpoint: 'https://hyper.example.com' };
        storage = new WorkbookTestRegistry(dql);
        storage.connections = [{ id: 'connection', params: { hyper: params } as ConnectionParams }];
        storage.connectionFiles.set(`connection/${STORAGE_CATALOG_RELATIONS}`, `-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.

`);
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, core: dql, storage });
        await runtime.restore();
        const state = runtime.connection('connection')!;
        expect(state.connectorType).toBe(ConnectorType.HYPER);
        // The metadata queries run on the session of the statements of the test, it sees their temporary tables
        const embedded = new EmbeddedDatabaseChannel(connection);
        const channel = {
            executeQuery: (query: string, abort?: AbortSignal) => {
                if (!statements.has(query)) queries.push(query);
                return embedded.executeQuery(query, abort);
            },
            close: async () => { },
        };
        queries = [];
        // The runtime sets the connection up with the channel, its probe doesn't reach the session
        await setupTestConnection(runtime, 'connection', { channel });
        catalog = runtime.catalog('connection')!;
        relations = state.catalogRelationEntryId;
        queries.length = 0;
    });
    afterAll(async () => {
        runtime.destroy();
        await connection.close();
    });

    it('reads only what a statement touched and never everything', async () => {
        await run('create table it_orders (id bigint, amount double precision)');
        expect(tables()).toEqual(['public.it_orders(id, amount)']);
        await run('create table it_others (x int)');
        expect(queries.every(query => query.includes('c.relname = '))).toBe(true);
        queries.length = 0;
        await run('select * from it_orders');
        expect(queries).toEqual([]);
    });

    it('reports what the database has, not what a statement says', async () => {
        await run('create table if not exists it_orders (other int)');
        expect(tables()).toContain('public.it_orders(id, amount)');
    });

    it('follows an ALTER of every kind', async () => {
        await run('alter table it_orders add column note text');
        expect(tables()).toContain('public.it_orders(id, amount, note)');
        await run('alter table it_orders rename column note to comment');
        expect(tables()).toContain('public.it_orders(id, amount, comment)');
        await run('alter table it_orders drop column comment');
        expect(tables()).toContain('public.it_orders(id, amount)');
        await run('alter table it_orders rename to it_sales');
        expect(tables()).toContain('public.it_sales(id, amount)');
        expect(tables().some(table => table.includes('it_orders'))).toBe(false);
    });

    it('follows temporary tables', async () => {
        await run('create temporary table it_temp (a int)');
        expect(tables().some(table => table.endsWith('.it_temp(a)'))).toBe(true);
        await run('drop table it_temp');
        expect(tables().some(table => table.includes('it_temp'))).toBe(false);
    });

    it('follows a statement that failed halfway', async () => {
        const statements = 'create table it_half (a int); select * from it_does_not_exist';
        await expect(execute(statements)).rejects.toThrow();
        const exists = (await connection.query(`select count(*) as n from pg_catalog.pg_class where relname = 'it_half'`)).getChild('n')!.get(0);
        expect(tables().some(table => table.includes('it_half'))).toBe(Number(exists) > 0);
        if (Number(exists) > 0) await run('drop table it_half');
    });

    it('does not let a script bring back a table that was dropped', async () => {
        // A script of a workbook on the connection declares the table, its catalog changes only through the runtime
        const { workbookId } = runtime.createWorkbook('connection', null, false);
        runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'create table it_declared (a int)', base: 'declaring' } });
        // It didn't run yet, the declaration provides it
        expect(reads(catalog, 'select * from it_declared')).toBe(true);
        await run('create table it_declared (a int)');
        await run('drop table it_declared');
        expect(reads(catalog, 'select * from it_declared')).toBe(false);
        await run('create table it_declared (b int)');
        expect(reads(catalog, 'select * from it_declared')).toBe(true);
        expect(tables()).toContain('public.it_declared(b)');
        await run('drop table it_declared');
        runtime.deleteWorkbook(workbookId);
    });

    it('follows a schema that is dropped', async () => {
        await run('create schema it_schema');
        await run('create table it_schema.a (x int)');
        await run('create table it_schema.b (y int)');
        expect(tables()).toEqual(expect.arrayContaining(['it_schema.a(x)', 'it_schema.b(y)']));
        await run('drop schema it_schema cascade');
        expect(tables().some(table => table.startsWith('it_schema.'))).toBe(false);
    });

    it('follows a schema that is renamed', async () => {
        await run('create schema it_before');
        await run('create table it_before.a (x int)');
        await run('alter schema it_before rename to it_after');
        expect(tables()).toContain('it_after.a(x)');
        expect(tables().some(table => table.startsWith('it_before.'))).toBe(false);
        await run('drop schema it_after cascade');
    });

    it('survives a restart without asking the connection', async () => {
        await run('create table it_kept (id int, name text)');
        await run('create table it_gone (a int)');
        await run('drop table it_gone');
        // The file that the runtime wrote
        await runtime.storage.flush();
        const file = storage.connectionFiles.get(`connection/${STORAGE_CATALOG_RELATIONS}`)!;
        expect(file).toContain('it_kept');
        const gone = catalog.absentRelations().map(name => readRelationName(name));

        // A new app: the file is parsed once, the descriptor stays and the text goes
        const restored = dql.createCatalog();
        const entry = restored.allocateEntryId();
        const output = dql.processBatch({ scripts: [{ id: 'relations', text: file, outputs: ['catalogDescriptor'] }] }).scripts[0];
        expect(output.diagnostics).toEqual([]);
        restored.replaceDescriptor(entry, CONNECTION, output.catalogDescriptor!);
        restored.replaceTables(entry, CONNECTION, { relations: gone.map(packRelationName), tables: [] });

        const kept = restored.readDescriptor(entry)!.tables.find(table => table.tableName?.tableName === 'it_kept')!;
        expect(kept.tableColumns.map(column => column.columnName)).toEqual(['id', 'name']);
        const declaring = dql.createScript(restored);
        declaring.replaceText('create table it_gone (a int)');
        declaring.analyze();
        restored.loadScript(declaring, dashql.buffers.catalog.CatalogLayer.SESSION);
        expect(reads(restored, 'select * from it_gone')).toBe(false);
    });
});
