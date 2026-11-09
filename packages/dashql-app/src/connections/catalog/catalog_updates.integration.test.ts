import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import { setupWebHyperDB } from '../../platform/hyperdb/hyperdb_provider_web.js';
import type { EmbeddedConnection } from '../../platform/database/embedded_database.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { updateHyperCatalog } from '../hyper/hyper_catalog_update.js';
import type { QueryExecutor } from '../query_executor.js';
import { catalogTablesOfDescriptor, generateRelationsFile, packRelationName, readRelationName } from './catalog_sql_generator.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const CONNECTION = dashql.buffers.catalog.CatalogLayer.CONNECTION;

/// The way of a statement to the catalog, on a real embedded Hyper
describe('the catalog of a connection follows statements', () => {
    let dql: dashql.DashQL;
    let connection: EmbeddedConnection;
    let catalog: dashql.DashQLCatalog;
    let functions: dashql.DashQLScript;
    let relations: number;
    let queries: string[];

    const executor: QueryExecutor = (_id, args) => {
        queries.push(args.query);
        return [queries.length, connection.query(args.query) as never];
    };
    /// Ask the connection about what a statement touched, like the catalog loader does
    const follow = async (statement: string) => {
        const touched = dql.touchedRelations(statement).map(name => readRelationName(name, 'hyper'));
        if (touched.length === 0) return;
        await updateHyperCatalog(new TestLogger(), 'connection', vi.fn(), 1, [], executor, catalog, dql, relations, functions, true,
            new AbortController().signal, { processor: async request => dql.processBatch(request) }, touched);
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
        const database = await setupWebHyperDB('catalog_updates_integration_test', new TestLogger());
        connection = await database.connect();
        catalog = dql.createCatalog();
        functions = dql.createScript(catalog);
        relations = catalog.allocateEntryId();
        queries = [];
    });
    afterAll(async () => {
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
