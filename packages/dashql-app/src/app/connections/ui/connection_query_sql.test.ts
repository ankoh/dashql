import type * as arrow from 'apache-arrow';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { getTestHyperDBClient, testDatabasePath } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';
import { connectionClientContext, HyperLogMetrics, queryEndsQuery, sqlframeClientContext } from '../hyper/hyper_log_metrics.js';
import { QueryScope } from './connection_metrics.js';
import { recentQueriesSql, queryShapesSql } from './connection_query_sql.js';

describe('Connection query SQL', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let logMetrics: HyperLogMetrics | null = null;
    let connections: HyperDBConnection[] = [];
    let nextDatabase = 1;

    beforeAll(async () => {
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
    }, 60_000);

    beforeEach(async () => {
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-query-sql-${nextDatabase++}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-query-sql-${nextDatabase++}.hyper`),
            terminateEngine: false,
        });
        // Poll explicitly, the timer would race with the assertions
        logMetrics = new HyperLogMetrics({
            logger: new TestLogger(),
            pollIntervalMs: 3_600_000,
            sink: async () => database!,
            prepareDatabase: async connectionId => await testDatabasePath(`dashql-query-sql-monitoring-${connectionId}.hyper`),
        });
    }, 60_000);

    afterEach(async () => {
        await logMetrics?.stop();
        logMetrics = null;
        for (const connection of connections) await connection.close().catch(() => {});
        connections = [];
        await database?.terminate();
        database = null;
    });

    afterAll(async () => {
        if (!sharedClient) await client?.terminate();
    });

    /// A connection of the user of a connection, a compute connection without one
    async function connect(connectionId: string | null = null): Promise<HyperDBConnection> {
        const connection = connectionId == null
            ? await database!.connect()
            : await database!.connect({ defaultDatabase: 'hyper', clientContext: connectionClientContext(connectionId) });
        connections.push(connection);
        return connection;
    }

    /// Is a row a setup statement of a session? HyperDB attaches the default database.
    function isSetup(row: { query: string }): boolean {
        return row.query.startsWith('ATTACH DATABASE');
    }

    /// Is a row neither a setup statement nor a query of the app on the extract?
    function isListed(row: { query: string; source: string }): boolean {
        return !isSetup(row) && row.source !== 'monitor' && row.source !== 'overview';
    }

    /// Run the queries of a connection, an app query, and the queries of another connection.
    /// The tests share the log of one Hyper, the connection id is unique.
    async function runQueries(): Promise<{ queryEnds: string; read: (sql: string) => Promise<arrow.Table> }> {
        const connectionId = crypto.randomUUID();
        logMetrics!.watch({ database: database!, sessions: true }, connectionId);
        expect(await logMetrics!.opened(connectionId)).toBe(true);
        const connection = await connect(connectionId);
        const other = await connect(crypto.randomUUID());
        await connection.query('SELECT 1 AS v WHERE 2 > 1');
        await connection.query('SELECT 1 AS v WHERE 3 > 1');
        await expect(connection.query('SELECT * FROM query_sql_missing_table')).rejects.toThrow();
        const compute = await database!.connect({ pooled: true, clientContext: sqlframeClientContext(connectionId) });
        await compute.query('SELECT 3 AS sqlframe_query');
        await compute.close();
        await other.query('SELECT 4 AS other_query');
        await logMetrics!.poll(connectionId);
        const state = logMetrics!.state.current.get(connectionId)!;
        return {
            queryEnds: queryEndsQuery(state.queryEnds!, state.clockOffsetMs!),
            read: sql => logMetrics!.query(connectionId, sql),
        };
    }

    it('lists the queries of a connection, newest first', async () => {
        const { queryEnds, read } = await runQueries();
        const runs = await read(recentQueriesSql(queryEnds, QueryScope.All, Date.now() - 60_000));
        // The setup statements belong to the client context of their session: the attaching on the connection is a query
        // of the user, the attaching on the compute connection is a query of a computation
        const setup = runs.toArray().filter(isSetup).filter(row => row.source !== 'monitor' && row.source !== 'overview').map(row => row.source);
        expect(setup.sort()).toEqual(['sqlframe', 'user']);
        expect(runs.toArray().filter(isListed).map(row => [row.query, row.status, row.source])).toEqual([
            ['SELECT 3 AS sqlframe_query', 'ok', 'sqlframe'],
            ['SELECT * FROM query_sql_missing_table', '42P01', 'user'],
            ['SELECT 1 AS v WHERE 3 > 1', 'ok', 'user'],
            ['SELECT 1 AS v WHERE 2 > 1', 'ok', 'user'],
        ]);
        const run = runs.toArray().find(row => row.query === 'SELECT 1 AS v WHERE 2 > 1')!;
        // The times are rounded to hundredths of milliseconds, not to whole milliseconds
        expect(run.elapsed_ms).toBeGreaterThan(0);
        expect(runs.toArray().some(row => !Number.isInteger(row.elapsed_ms))).toBe(true);
        expect(run.memory_mb).not.toBeNull();
        expect(runs.toArray().find(row => row.status === '42P01')!.error).toContain('query_sql_missing_table');

        const userRuns = await read(recentQueriesSql(queryEnds, QueryScope.User, Date.now() - 60_000));
        expect(userRuns.numRows).toBe(4);
        const appRuns = await read(recentQueriesSql(queryEnds, QueryScope.App, Date.now() - 60_000));
        expect(appRuns.toArray().filter(isListed).map(row => row.query)).toEqual(['SELECT 3 AS sqlframe_query']);
        // The reads of the log are queries of the app too
        expect(appRuns.toArray().some(row => row.source === 'monitor')).toBe(true);
        // The queries ended before the window
        const later = await read(recentQueriesSql(queryEnds, QueryScope.All, Date.now() + 60_000));
        expect(later.numRows).toBe(0);
    }, 60_000);

    it('groups the queries that only differ in their literals', async () => {
        const { queryEnds, read } = await runQueries();
        const shapes = await read(queryShapesSql(queryEnds, QueryScope.User, Date.now() - 60_000));
        const all = shapes.toArray().map(row => row.toJSON());
        const rows = all.filter(row => !isSetup(row));
        expect(rows).toHaveLength(2);
        const shape = rows.find(row => row.queries === 2)!;
        // The text of the newest run
        expect(shape.query).toBe('SELECT 1 AS v WHERE 3 > 1');
        expect(shape.failed).toBe(0);
        expect(rows.find(row => row.queries === 1)!.failed).toBe(1);
        expect(all.reduce((sum, row) => sum + (row.share_pct ?? 0), 0)).toBeCloseTo(100, 0);
        // The most elapsed time first
        expect(all.every((row, i) => i === 0 || all[i - 1].total_ms >= row.total_ms)).toBe(true);
    }, 60_000);
});
