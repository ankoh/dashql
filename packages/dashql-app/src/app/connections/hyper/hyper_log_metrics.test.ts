import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { getTestHyperDBClient } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';
import { HyperLogMetrics, queryShapeOf, sqlframeClientContext, wallClockToEpochMs } from './hyper_log_metrics.js';

describe('Hyper log metrics', () => {
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
            computeDatabasePath: `/mnt/fs/dashql-log-metrics-${nextDatabase++}.hyper`,
            defaultDatabasePath: `/mnt/fs/dashql-log-metrics-${nextDatabase++}.hyper`,
            terminateEngine: false,
        });
        // Poll explicitly, the timer would race with the assertions
        logMetrics = new HyperLogMetrics({ logger: new TestLogger(), pollIntervalMs: 3_600_000 });
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

    async function connect(): Promise<HyperDBConnection> {
        const connection = await database!.connect();
        connections.push(connection);
        return connection;
    }

    it('converts the wall-clock time of the log to the epoch', () => {
        const local = new Date(2026, 9, 24, 14, 5, 40, 123);
        const wallClock = Date.UTC(2026, 9, 24, 14, 5, 40, 123);
        expect(wallClockToEpochMs(wallClock)).toBe(local.getTime());
    });

    it('attributes the finished queries to the connections of their sessions', async () => {
        const first = await connect();
        const second = await connect();
        const untracked = await connect();
        const firstSession = await logMetrics!.track(database!, first);
        const secondSession = await logMetrics!.track(database!, second);
        expect(firstSession).not.toBeNull();
        expect(secondSession).not.toBeNull();
        expect(firstSession).not.toBe(secondSession);
        logMetrics!.assign('first', firstSession!);
        logMetrics!.assign('second', secondSession!);

        const before = Date.now();
        await first.query('SELECT sum(i) AS s FROM generate_series(1, 100000) g(i)');
        await expect(first.query('SELECT * FROM query_log_missing_table')).rejects.toThrow();
        await second.query('SELECT 1 AS one');
        await untracked.query('SELECT 2 AS two');
        await logMetrics!.poll();
        const after = Date.now();

        const firstQueries = logMetrics!.queries('first');
        expect(firstQueries.map(query => query.succeeded)).toEqual([true, false]);
        expect(firstQueries.every(query => query.sessionId === firstSession)).toBe(true);
        const [succeeded, failed] = firstQueries;
        expect(succeeded.query).toContain('generate_series');
        expect(succeeded.statement).toBe('SELECT');
        expect(succeeded.rows).toBe(1);
        expect(succeeded.elapsed).toBeGreaterThan(0);
        expect(succeeded.threadTime).toBeGreaterThan(0);
        expect(succeeded.cpuTime).toBeGreaterThan(0);
        expect(succeeded.waitTime).toBeGreaterThanOrEqual(0);
        expect(succeeded.peakMemoryMb).not.toBeNull();
        expect(failed.errorCode).toBe('42P01');
        expect(failed.errorMessage).toContain('query_log_missing_table');
        for (const query of firstQueries) {
            expect(query.endedAt).toBeGreaterThanOrEqual(before - 1_000);
            expect(query.endedAt).toBeLessThanOrEqual(after + 1_000);
        }
        expect(logMetrics!.queries('second').map(query => query.query)).toEqual(['SELECT 1 AS one']);
        expect(logMetrics!.queries('unknown')).toEqual([]);
    }, 60_000);

    it('attributes the queries of pooled connections by their client context', async () => {
        const channel = await connect();
        const session = await logMetrics!.track(database!, channel);
        logMetrics!.assign('connection', session!);

        const compute = await database!.connect({ pooled: true, clientContext: sqlframeClientContext('connection') });
        await compute.query('SELECT 3 AS sqlframe_query');
        await expect(compute.query('SELECT * FROM sqlframe_missing_table')).rejects.toThrow();
        await compute.close();
        const other = await database!.connect({ pooled: true, clientContext: sqlframeClientContext('other') });
        await other.query('SELECT 4 AS other_query');
        await other.close();
        // The pooled session is reused without the client context, its query is attributed to no connection
        const plain = await database!.connect({ pooled: true });
        await plain.query('SELECT 5 AS plain_query');
        await plain.close();
        await channel.query('SELECT 1 AS one');
        await logMetrics!.poll();

        expect(logMetrics!.queries('connection').map(query => [query.query, query.system, query.succeeded])).toEqual([
            ['SELECT 3 AS sqlframe_query', true, true],
            ['SELECT * FROM sqlframe_missing_table', true, false],
            ['SELECT 1 AS one', false, true],
        ]);
        expect(logMetrics!.queries('other').map(query => query.query)).toEqual(['SELECT 4 AS other_query']);
        logMetrics!.retain(new Set(['connection']));
        expect(logMetrics!.queries('other')).toEqual([]);
        expect(logMetrics!.queries('connection')).toHaveLength(3);
    }, 60_000);

    it('gives queries that only differ in their literals the same shape', async () => {
        expect(queryShapeOf('bfe4.387e195b3a02.24573b')).toBe('387e195b3a02');
        expect(queryShapeOf(null)).toBeNull();
        const connection = await connect();
        const session = await logMetrics!.track(database!, connection);
        logMetrics!.assign('connection', session!);
        await connection.query('SELECT 1 AS v WHERE 2 > 1');
        await connection.query('SELECT 1 AS v WHERE 3 > 1');
        await connection.query('SELECT 2 AS other');
        await logMetrics!.poll();
        const [a, b, c] = logMetrics!.queries('connection');
        expect(a.queryShape).not.toBeNull();
        expect(a.queryShape).toBe(b.queryShape);
        expect(c.queryShape).not.toBe(a.queryShape);
    }, 60_000);

    it('reads the processed rows of the queries', async () => {
        const connection = await connect();
        const session = await logMetrics!.track(database!, connection);
        logMetrics!.assign('connection', session!);
        await connection.execute('CREATE TABLE log_metrics_scan AS SELECT i FROM generate_series(1, 1000) g(i)');
        await connection.query('SELECT count(*) AS n FROM log_metrics_scan');
        await logMetrics!.poll();
        const scan = logMetrics!.queries('connection').find(query => query.query?.includes('count(*)'));
        expect(scan?.processedRows).toBe(1000);
    }, 60_000);

    it('reads every query once and keeps the snapshots until the queries change', async () => {
        const connection = await connect();
        const session = await logMetrics!.track(database!, connection);
        logMetrics!.assign('connection', session!);
        let notifications = 0;
        const unsubscribe = logMetrics!.subscribe(() => ++notifications);

        await connection.query('SELECT 1 AS one');
        await logMetrics!.poll();
        const snapshot = logMetrics!.queries('connection');
        expect(snapshot).toHaveLength(1);
        expect(notifications).toBe(1);

        await logMetrics!.poll();
        expect(logMetrics!.queries('connection')).toBe(snapshot);
        expect(notifications).toBe(1);

        await connection.query('SELECT 2 AS two');
        await logMetrics!.poll();
        expect(logMetrics!.queries('connection')).toHaveLength(2);
        expect(snapshot).toHaveLength(1);
        unsubscribe();
    }, 60_000);

    it('keeps the queries of a connection across sessions and forgets deleted connections', async () => {
        const before = await connect();
        const beforeSession = await logMetrics!.track(database!, before);
        logMetrics!.assign('connection', beforeSession!);
        await before.query('SELECT 1 AS one');
        await logMetrics!.poll();

        const after = await connect();
        const afterSession = await logMetrics!.track(database!, after);
        logMetrics!.assign('connection', afterSession!);
        await after.query('SELECT 2 AS two');
        await logMetrics!.poll();
        expect(logMetrics!.queries('connection').map(query => query.query)).toEqual(['SELECT 1 AS one', 'SELECT 2 AS two']);

        logMetrics!.retain(new Set());
        expect(logMetrics!.queries('connection')).toEqual([]);
    }, 60_000);
});

describe('Hyper log metrics of resources', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let logMetrics: HyperLogMetrics | null = null;
    let connection: HyperDBConnection | null = null;

    beforeAll(async () => {
        // The app settings log the resource usage every second
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: '/mnt/fs/dashql-log-metrics-resources-compute.hyper',
            defaultDatabasePath: '/mnt/fs/dashql-log-metrics-resources-user.hyper',
            terminateEngine: false,
        });
    }, 60_000);

    afterAll(async () => {
        await logMetrics?.stop();
        await connection?.close().catch(() => {});
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    it('reads the resource samples of the Hyper process', async () => {
        logMetrics = new HyperLogMetrics({ logger: new TestLogger(), pollIntervalMs: 3_600_000 });
        connection = await database!.connect();
        const session = await logMetrics.track(database!, connection);
        logMetrics.assign('connection', session!);
        const before = Date.now();
        await new Promise(resolve => setTimeout(resolve, 2_500));
        await connection.query('SELECT 1 AS one');
        await logMetrics.poll();
        const after = Date.now();

        const samples = logMetrics.resourceSamples();
        expect(samples.length).toBeGreaterThanOrEqual(1);
        for (const sample of samples) {
            expect(sample.sampledAt).toBeGreaterThanOrEqual(before - 1_000);
            expect(sample.sampledAt).toBeLessThanOrEqual(after + 1_000);
            expect(sample.processMemoryMb).toBeGreaterThan(0);
            expect(sample.transactionMemoryMb).not.toBeNull();
            expect(sample.storageMemoryMb).not.toBeNull();
            for (const load of [sample.overallLoad, sample.schedulerLoad, sample.memoryLoad]) {
                expect(load).toBeGreaterThanOrEqual(0);
                expect(load).toBeLessThanOrEqual(1);
            }
        }
        // The resource events belong to no session, the connection only has its query
        expect(logMetrics.queries('connection').map(query => query.query)).toEqual(['SELECT 1 AS one']);
    }, 60_000);
});
