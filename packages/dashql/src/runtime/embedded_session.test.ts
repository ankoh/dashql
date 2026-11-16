import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as dashql from '../core/index.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { connectEmbeddedHyper } from '../platform/connections/embedded_database_channel.js';
import type { HyperParamsLike } from '../platform/connections/hyper/local_cloud.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';
import { createRuntime, type Runtime } from './runtime.js';
import { connectEmbeddedSession, type EmbeddedSession } from './embedded_session.js';
import { QueryType } from '../platform/query/query_execution_state.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The connection of the shell: its statements run with the query executor on a connection of the runtime to the
/// embedded Hyper, the catalog loader of the runtime follows them
describe('a session on a connection to the embedded Hyper', () => {
    let dql: dashql.DashQL;
    let database: HyperDB;
    let runtime: Runtime;
    let session: EmbeddedSession;
    let queries: string[];
    /// The statements of the test, the other queries are the ones of the catalog loader
    const statements = new Set<string>();
    const catalogQueries = () => queries.filter(query => !statements.has(query));

    /// Run a statement like the shell does
    const run = async (statement: string) => {
        statements.add(statement);
        const metadata = { queryType: QueryType.USER_PROVIDED, title: 'Shell Query', description: null, issuer: 'DashQL Shell', userProvided: true };
        const [, execution] = runtime.execute(session.connectionId, { query: statement, metadata, throwOnError: true });
        await execution;
        await runtime.settleCatalog(session.connectionId);
    };
    /// The tables of the catalog as `table(a, b)`, like completion sees them
    const tables = () => (session.catalog.describeEntries().unpack() as dashql.buffers.catalog.CatalogEntriesT).entries.flatMap(entry =>
        entry.schemas.flatMap(schema => schema.tables.map(table =>
            `${table.tableName}(${table.columns.map(column => String(column.columnName)).join(', ')})`)));

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        database = await openTestHyperDB('embedded_session_test');
        queries = [];
        runtime = createRuntime({
            logger: new TestLogger(),
            scheduler: TASK_UPDATE_SCHEDULER,
            core: dql,
            channels: {
                connect: async (_connectionId, request) => {
                    if (request.type !== 'hyper' || request.kind !== 'embedded') throw new Error(`no ${request.type} channel`);
                    const channel = await connectEmbeddedHyper(database, request.params as HyperParamsLike);
                    // Hear the queries of the catalog loader
                    return {
                        executeQuery: (params: { query: string }, abort?: AbortSignal) => {
                            queries.push(params.query);
                            return channel.executeQuery(params as never, abort);
                        },
                        close: () => channel.close(),
                    };
                },
            },
        });
        session = await connectEmbeddedSession(runtime, 'shell');
    });
    afterAll(async () => {
        await runtime.destroy();
        await database.terminate();
    });

    it('follows the relations that statements create, change and drop', async () => {
        await run('create table shell_orders (id bigint, amount double precision)');
        expect(tables()).toContain('shell_orders(id, amount)');
        await run('alter table shell_orders add column note text');
        expect(tables()).toContain('shell_orders(id, amount, note)');
        await run('drop table shell_orders');
        expect(tables().some(table => table.startsWith('shell_orders'))).toBe(false);
    });

    it('sees the temporary tables of the session', async () => {
        await run('create temporary table shell_temp (a int)');
        expect(tables()).toContain('shell_temp(a)');
        await run('drop table shell_temp');
        expect(tables().some(table => table.startsWith('shell_temp'))).toBe(false);
    });

    it('asks the connection only about the relations of a statement, a read asks nothing', async () => {
        await run('create table shell_one (a int)');
        queries.length = 0;
        await run('select * from shell_one');
        expect(catalogQueries()).toEqual([]);
        await run('create table shell_two (b int)');
        expect(catalogQueries().length).toBeGreaterThan(0);
        expect(catalogQueries().every(query => query.includes("c.relname = 'shell_two'"))).toBe(true);
        await run('drop table shell_one');
        await run('drop table shell_two');
    });

    it('closes the session and sets the connection up again', async () => {
        await run('create table shell_kept (a int)');
        session.close();
        expect(runtime.connection('shell')!.details.channel ?? null).toBeNull();
        // A replaced session that closes late leaves the connection to its successor
        const replaced = session;
        session = await connectEmbeddedSession(runtime, 'shell');
        replaced.close();
        expect(runtime.connection('shell')!.details.channel).toEqual(expect.any(Number));
        expect([...runtime.store.all('connection').keys()]).toEqual(['shell']);
        // The connection comes online without a description, the catalog loader describes it in full
        await vi.waitFor(() => expect(tables()).toContain('shell_kept(a)'), { timeout: 4000 });
        await run('drop table shell_kept');
    });
});
