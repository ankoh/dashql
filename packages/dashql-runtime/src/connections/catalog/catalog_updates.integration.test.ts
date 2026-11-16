import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import type * as pb from '@ankoh/dashql-platform/proto';
import { openTestHyperDB } from '@ankoh/dashql-platform/testing/test_hyperdb';
import type { EmbeddedConnection } from '@ankoh/dashql-platform/platform/database/embedded_database';
import { ConnectorType } from '@ankoh/dashql-platform/connections/connector_info';
import { setupStepAction } from '@ankoh/dashql-platform/connections/connection_state';
import { createRuntime, type Runtime } from '../../runtime.js';
import type { ConnectionParams } from '@ankoh/dashql-platform/storage/storage_backend';
import { STORAGE_CATALOG_RELATIONS } from '@ankoh/dashql-platform/storage/storage_backend';
import { TASK_UPDATE_SCHEDULER } from '../../store/store.js';
import { TestLogger } from '@ankoh/dashql-platform/testing/test_logger';
import { WorkbookTestRegistry } from '@ankoh/dashql-platform/testing/workbook_test_backend';
import { EmbeddedDatabaseChannel, EmbeddedHyperDatabaseChannel } from '@ankoh/dashql-platform/connections/embedded/embedded_database_channel';
import { catalogTablesOfDescriptor, generateRelationsFile, packRelationName, readRelationName } from '@ankoh/dashql-platform/connections/catalog/catalog_sql_generator';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const CONNECTION = dashql.buffers.catalog.CatalogLayer.CONNECTION;

/// The way of a statement to the catalog, on a real embedded Hyper, through the catalog loader of the runtime
describe('the catalog of a connection follows statements', () => {
    let dql: dashql.DashQL;
    let connection: EmbeddedConnection;
    let runtime: Runtime;
    let catalog: dashql.DashQLCatalog;
    let relations: number;
    let queries: string[];

    /// Wait until the catalog loader answered every relation that statements touched
    const settled = () => vi.waitFor(() => {
        const updates = runtime.connection('connection')!.catalogUpdates;
        expect([updates.touchedRelations, updates.tasksRunning]).toEqual([[], []]);
    }, { timeout: 4000 });
    /// The relations that a statement touched, like the query executor does after a statement, the catalog loader asks
    /// the connection about them
    const follow = async (statement: string) => {
        const names = dql.touchedRelations(statement).map(name => readRelationName(name));
        if (names.length === 0) return;
        const value = names.map(name => ({ databaseName: name.databaseName || null, schemaName: name.schemaName || null, tableName: name.tableName || null }));
        runtime.dispatch({ connection: 'connection' }, { kind: 'relationsTouched', value: { names: value } });
        await settled();
    };
    const run = async (statement: string) => {
        await connection.query(statement);
        await follow(statement);
    };
    /// The relations as `schema.table(a, b)`
    const tables = () => catalogTablesOfDescriptor(catalog.readDescriptor(relations))
        .map(table => `${table.schemaName}.${table.tableName}(${table.columns.map(column => column.name).join(', ')})`);
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
        const storage = new WorkbookTestRegistry();
        storage.connections = [{ id: 'connection', params: { hyper: params } as ConnectionParams }];
        storage.connectionFiles.set(`connection/${STORAGE_CATALOG_RELATIONS}`, generateRelationsFile(null));
        runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql, storage });
        await runtime.restore();
        const state = runtime.connection('connection')!;
        expect(state.connectorType).toBe(ConnectorType.HYPER);
        // The metadata queries run on the session of the statements of the test, it sees their temporary tables
        const embedded = new EmbeddedHyperDatabaseChannel(new EmbeddedDatabaseChannel(connection));
        const channel = {
            executeQuery: (params: pb.salesforce_hyperdb_grpc_v1.pb.QueryParam, abort?: AbortSignal) => {
                queries.push(params.query);
                return embedded.executeQuery(params, abort);
            },
            close: async () => { },
        };
        queries = [];
        runtime.dispatch({ connection: 'connection' }, setupStepAction('HYPER_CHANNEL_READY', params, runtime.handles.register(channel)));
        runtime.dispatch({ connection: 'connection' }, setupStepAction('HEALTH_CHECK_SUCCEEDED'));
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
        await expect(connection.query(statements)).rejects.toThrow();
        await follow(statements);
        const exists = (await connection.query(`select count(*) as n from pg_catalog.pg_class where relname = 'it_half'`)).getChild('n')!.get(0);
        expect(tables().some(table => table.includes('it_half'))).toBe(Number(exists) > 0);
        if (Number(exists) > 0) await run('drop table it_half');
    });

    it('does not let a script bring back a table that was dropped', async () => {
        const declaring = dql.createScript(catalog);
        declaring.replaceText('create table it_declared (a int)');
        declaring.analyze();
        catalog.loadScript(declaring, dashql.buffers.catalog.CatalogLayer.SESSION);
        // It didn't run yet, the declaration provides it
        expect(reads(catalog, 'select * from it_declared')).toBe(true);
        await run('create table it_declared (a int)');
        await run('drop table it_declared');
        expect(reads(catalog, 'select * from it_declared')).toBe(false);
        await run('create table it_declared (b int)');
        expect(reads(catalog, 'select * from it_declared')).toBe(true);
        expect(tables()).toContain('public.it_declared(b)');
        await run('drop table it_declared');
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
        const file = generateRelationsFile(catalog.readDescriptor(relations));
        const gone = catalog.absentRelations().map(name => readRelationName(name));

        // A new app: the file is parsed once, the descriptor stays and the text goes
        const restored = dql.createCatalog();
        const entry = restored.allocateEntryId();
        const output = dql.processBatch({ scripts: [{ id: 'relations', text: file, outputs: ['catalogDescriptor'] }] }).scripts[0];
        expect(output.diagnostics).toEqual([]);
        restored.replaceDescriptor(entry, CONNECTION, output.catalogDescriptor!);
        restored.replaceTables(entry, CONNECTION, { relations: gone.map(packRelationName), tables: [] });

        const kept = catalogTablesOfDescriptor(restored.readDescriptor(entry)).find(table => table.tableName === 'it_kept')!;
        expect(kept.columns.map(column => column.name)).toEqual(['id', 'name']);
        const declaring = dql.createScript(restored);
        declaring.replaceText('create table it_gone (a int)');
        declaring.analyze();
        restored.loadScript(declaring, dashql.buffers.catalog.CatalogLayer.SESSION);
        expect(reads(restored, 'select * from it_gone')).toBe(false);
    });
});
