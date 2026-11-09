import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '@ankoh/dashql-core';
import { setupWebHyperDB } from '../platform/hyperdb/hyperdb_provider_web.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import type { EmbeddedConnection } from '../platform/database/embedded_database.js';
import { EmbeddedDatabaseCatalog } from './embedded_database_catalog.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('the catalog of a shell on an embedded database', () => {
    let dql: dashql.DashQL;
    let connection: EmbeddedConnection;
    let catalog: dashql.DashQLCatalog;
    let relations: EmbeddedDatabaseCatalog;

    /// Run a statement like the shell does
    const run = async (statement: string) => {
        await connection.query(statement);
        await relations.afterStatement(statement);
    };
    /// The catalog tables as `table(a, b)`, a script is described with its columns in name order
    const tables = () => (catalog.describeEntries().unpack() as dashql.buffers.catalog.CatalogEntriesT).entries.flatMap(entry =>
        entry.schemas.flatMap(schema => schema.tables.map(table =>
            `${table.tableName}(${table.columns.map(column => String(column.columnName)).join(', ')})`)));

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const database = await setupWebHyperDB('embedded_database_catalog_test', new TestLogger());
        connection = await database.connect();
    });
    afterAll(async () => {
        await connection.close();
    });
    afterEach(() => {
        relations?.destroy();
        catalog?.destroy();
        dql.resetUnsafe();
    });
    const setup = () => {
        catalog = dql.createCatalog();
        relations = new EmbeddedDatabaseCatalog(dql, catalog, text => connection.query(text));
    };

    it('follows the relations that statements create and drop, without the system schemas', async () => {
        setup();
        await run('create table shell_orders (id bigint, amount double precision)');
        expect(tables()).toEqual(['shell_orders(id, amount)']);
        await run('drop table shell_orders');
        expect(tables()).toEqual([]);
    });

    it('reports what the database has, not what a statement says', async () => {
        setup();
        await run('create table shell_existing (a int, b int)');
        await run('create table if not exists shell_existing (a int)');
        expect(tables()).toEqual(['shell_existing(a, b)']);
        await run('drop table shell_existing');
    });

    it('reports temporary relations', async () => {
        setup();
        await run('create temporary table shell_temp (a int)');
        expect(tables()).toEqual(['shell_temp(a)']);
        await run('drop table shell_temp');
        expect(tables()).toEqual([]);
    });

    it('asks only about the tables of a statement, a read asks nothing', async () => {
        setup();
        const query = vi.fn((text: string) => connection.query(text));
        relations.destroy();
        relations = new EmbeddedDatabaseCatalog(dql, catalog, query);
        await relations.afterStatement('select 1');
        expect(query).not.toHaveBeenCalled();
        await connection.query('create table shell_one (a int)');
        await connection.query('create table shell_two (b int)');
        await relations.afterStatement('create table shell_one (a int)');
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain("c.relname = 'shell_one'");
        expect(tables()).toEqual(['shell_one(a)']);
        await connection.query('drop table shell_one');
        await connection.query('drop table shell_two');
    });

    it('follows a statement that changes a table, and one that moves it', async () => {
        setup();
        await run('create table shell_altered (a int)');
        await run('alter table shell_altered add column b int');
        expect(tables()).toEqual(['shell_altered(a, b)']);
        await run('alter table shell_altered drop column a');
        expect(tables()).toEqual(['shell_altered(b)']);
        await run('alter table shell_altered rename to shell_moved');
        expect(tables()).toEqual(['shell_moved(b)']);
        await run('drop table shell_moved');
        expect(tables()).toEqual([]);
    });

    it('follows a schema that is dropped', async () => {
        setup();
        await run('create schema shell_gone');
        await run('create table shell_gone.t (a int)');
        expect(tables()).toEqual(['t(a)']);
        await run('drop schema shell_gone cascade');
        expect(tables()).toEqual([]);
    });

    it('asks nothing after a statement that does not parse', async () => {
        setup();
        const query = vi.fn((text: string) => connection.query(text));
        relations.destroy();
        relations = new EmbeddedDatabaseCatalog(dql, catalog, query);
        await relations.afterStatement('vacuum everything');
        expect(query).not.toHaveBeenCalled();
    });
});
