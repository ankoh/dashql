import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import { createTestHyperDBClient, getTestHyperDBClient, testDatabasePath } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, quoteIdentifier, type HyperDBClient, type HyperDBConnection, type HyperDBSettings } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';
import type { HyperDBSourceDatabase } from '../../../platform/hyperdb/hyperdb_incremental_extract.js';
import {
    connectionClientContext,
    HyperLogMetrics,
    HyperLogStatus,
    lastExtractRow,
    queryEndsQuery,
    readQueryEnds,
    readResourceSamples,
    resourceSamplesQuery,
    sqlframeClientContext,
    type HyperQueryEnd,
} from './hyper_log_metrics.js';

/// The offset of the clock of the embedded Hyper from UTC, the time zone of the app, 0 and not -0 in UTC
const LOCAL_CLOCK_OFFSET_MS = 0 - new Date().getTimezoneOffset() * 60_000;

/// A Hyper whose queries run in sessions of their own, like a remote Hyper over gRPC or HTTP
function sessionless(database: HyperDB): HyperDBSourceDatabase {
    return {
        connect: async options => {
            const run = async <T>(fn: (connection: HyperDBConnection) => Promise<T>): Promise<T> => {
                const connection = await database.connect(options);
                try {
                    return await fn(connection);
                } finally {
                    await connection.close();
                }
            };
            return {
                query: (sql, abort) => run(connection => connection.query(sql, abort)),
                execute: (statement, abort) => run(connection => connection.execute(statement, abort)),
                close: async () => {},
            };
        },
    };
}

/// Is a query a statement of the app on the sessions? HyperDB attaches the default database.
function isSetup(query: HyperQueryEnd): boolean {
    return query.statement === 'ATTACH';
}

describe('Hyper log metrics', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let logMetrics: HyperLogMetrics | null = null;
    let connections: HyperDBConnection[] = [];
    let nextDatabase = 1;
    /// The tests share the log of one Hyper and every extract backfills it, the connection ids are unique per test
    let run = '';
    const scoped = (connectionId: string) => `${connectionId}@${run}`;
    /// The monitoring databases of the connections of a test
    const databases = new Map<string, string>();

    beforeAll(async () => {
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        // The tests share the database, their connections and monitoring databases are unique per test
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-log-metrics-${nextDatabase++}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-log-metrics-${nextDatabase++}.hyper`),
            terminateEngine: false,
        });
    }, 60_000);

    beforeEach(() => {
        run = crypto.randomUUID();
        databases.clear();
        // Poll explicitly, the timer would race with the assertions
        logMetrics = new HyperLogMetrics({
            logger: new TestLogger(),
            pollIntervalMs: 3_600_000,
            sink: async () => database!,
            prepareDatabase: async connectionId => {
                let path = databases.get(connectionId);
                if (path == null) {
                    path = await testDatabasePath(`dashql-monitoring-${crypto.randomUUID()}.hyper`);
                    databases.set(connectionId, path);
                }
                return path;
            },
        });
    });

    afterEach(async () => {
        await logMetrics?.stop();
        logMetrics = null;
        for (const connection of connections) await connection.close().catch(() => {});
        connections = [];
        const cleanup = await database!.connect();
        for (const path of databases.values()) await cleanup.execute(`DROP DATABASE IF EXISTS ${quoteIdentifier(path)}`).catch(() => {});
        await cleanup.close();
    });

    afterAll(async () => {
        await database?.terminate();
        database = null;
        if (!sharedClient) await client?.terminate();
    });

    /// Monitor the log of a connection
    async function watch(connectionId: string): Promise<void> {
        logMetrics!.watch({ database: database!, sessions: true }, scoped(connectionId));
        const opened = await logMetrics!.opened(scoped(connectionId));
        expect(opened, JSON.stringify(logMetrics!.state.current.get(scoped(connectionId))?.error)).toBe(true);
    }

    /// A connection of the user that the client context attributes to a connection
    async function connect(connectionId: string | null): Promise<HyperDBConnection> {
        const connection = await database!.connect({
            defaultDatabase: 'hyper',
            clientContext: connectionId == null ? undefined : connectionClientContext(scoped(connectionId)),
        });
        connections.push(connection);
        return connection;
    }

    /// Poll the log of a connection
    async function poll(connectionId: string): Promise<void> {
        await logMetrics!.poll(scoped(connectionId));
    }

    /// Poll the log of a connection until its own queries satisfy a condition, at most for 10s.
    /// The log may not hold the end of a query yet right after its result, e.g. under the load of CI.
    async function pollUntil(connectionId: string, done: (own: HyperQueryEnd[]) => boolean): Promise<void> {
        const deadline = performance.now() + 10_000;
        await poll(connectionId);
        while (!done(await ownQueries(connectionId)) && performance.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 250));
            await poll(connectionId);
        }
    }

    /// The finished queries in the extract of a connection, read like the connection overview
    async function queries(connectionId: string): Promise<HyperQueryEnd[]> {
        const { queryEnds, clockOffsetMs } = logMetrics!.state.current.get(scoped(connectionId))!;
        return readQueryEnds(await logMetrics!.query(scoped(connectionId), queryEndsQuery(queryEnds!, clockOffsetMs!)));
    }

    /// The finished queries of a connection without the queries of the app on the extract and the setup of the sessions
    async function ownQueries(connectionId: string): Promise<HyperQueryEnd[]> {
        return (await queries(connectionId))
            .filter(query => query.queryType !== 'monitor' && query.queryType !== 'overview' && !isSetup(query));
    }

    it('reads the clock offset of the log', async () => {
        await watch('connection');
        expect(logMetrics!.state.current.get(scoped('connection'))!.clockOffsetMs).toBe(LOCAL_CLOCK_OFFSET_MS);
    }, 60_000);

    it('extracts the queries of a Hyper without sessions from the watermark', async () => {
        logMetrics!.watch({ database: sessionless(database!), sessions: false }, scoped('connection'));
        expect(await logMetrics!.opened(scoped('connection'))).toBe(true);
        expect(logMetrics!.state.current.get(scoped('connection'))!.clockOffsetMs).toBe(LOCAL_CLOCK_OFFSET_MS);
        const connection = await connect('connection');
        const before = Date.now();
        await connection.query('SELECT 1 AS before_poll');
        await poll('connection');
        await connection.query('SELECT 2 AS after_poll');
        await poll('connection');
        await poll('connection');
        const own = await ownQueries('connection');
        expect(own.map(query => query.query)).toEqual(['SELECT 1 AS before_poll', 'SELECT 2 AS after_poll']);
        for (const query of own) expect(query.endedAt).toBeGreaterThanOrEqual(before - 1_000);
        // The reads of the monitor run with its client context
        expect((await queries('connection')).some(query => query.queryType === 'monitor' && query.query?.includes('hyper_log'))).toBe(true);
    }, 60_000);

    it('extracts the finished queries of a connection by its client context', async () => {
        await watch('first');
        await watch('second');
        const first = await connect('first');
        const second = await connect('second');
        const unattributed = await connect(null);

        const before = Date.now();
        await first.query('SELECT sum(i) AS s FROM generate_series(1, 100000) g(i)');
        await expect(first.query('SELECT * FROM query_log_missing_table')).rejects.toThrow();
        await second.query('SELECT 1 AS one');
        await unattributed.query('SELECT 2 AS two');
        await pollUntil('first', own => own.length >= 2);
        await pollUntil('second', own => own.length >= 1);
        const after = Date.now();

        const firstQueries = await ownQueries('first');
        expect(firstQueries.map(query => [query.succeeded, query.queryType, query.sentByApp])).toEqual([
            [true, 'user', false],
            [false, 'user', false],
        ]);
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
        expect((await ownQueries('second')).map(query => query.query)).toEqual(['SELECT 1 AS one']);
        // The setup of a session runs with its client context
        expect((await queries('first')).filter(query => isSetup(query) && query.queryType === 'user')).toHaveLength(1);
    }, 60_000);

    it('extracts the queries of pooled connections by their client context', async () => {
        await watch('connection');
        const channel = await connect('connection');
        const compute = await database!.connect({ pooled: true, clientContext: sqlframeClientContext(scoped('connection')) });
        await compute.query('SELECT 3 AS sqlframe_query');
        await expect(compute.query('SELECT * FROM sqlframe_missing_table')).rejects.toThrow();
        await compute.close();
        const other = await database!.connect({ pooled: true, clientContext: sqlframeClientContext(scoped('other')) });
        await other.query('SELECT 4 AS other_query');
        await other.close();
        await channel.query('SELECT 1 AS one');
        await poll('connection');

        expect((await ownQueries('connection')).map(query => [query.query, query.sentByApp, query.succeeded])).toEqual([
            ['SELECT 3 AS sqlframe_query', true, true],
            ['SELECT * FROM sqlframe_missing_table', true, false],
            ['SELECT 1 AS one', false, true],
        ]);
        // The attaching of the compute database runs with the client context of its session
        expect((await queries('connection')).filter(query => isSetup(query) && query.queryType === 'sqlframe')).toHaveLength(1);
    }, 60_000);

    it('reads the processed rows of the queries', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.execute('CREATE TABLE log_metrics_scan AS SELECT i FROM generate_series(1, 1000) g(i)');
        await connection.query('SELECT count(*) AS n FROM log_metrics_scan');
        await poll('connection');
        const scan = (await queries('connection')).find(query => query.query?.includes('count(*)'));
        expect(scan?.processedRows).toBe(1000);
    }, 60_000);

    it('extracts the queries of the own monitor and notifies new rows', async () => {
        await watch('connection');
        await watch('other');
        const connection = await connect('connection');
        const transfers = logMetrics!.state.current.get(scoped('connection'))!.transfers;
        await connection.query('SELECT 1 AS one');
        await poll('connection');
        await queries('connection');
        await poll('connection');
        await poll('other');
        expect(logMetrics!.state.current.get(scoped('connection'))!.transfers).toBeGreaterThan(transfers);
        expect((await ownQueries('connection')).map(query => query.query)).toEqual(['SELECT 1 AS one']);
        // Every read of the log is read by the next reader. The sink writes the extract.
        const listed = await queries('connection');
        const monitor = listed.filter(query => query.queryType === 'monitor');
        expect(monitor.some(query => query.query?.includes('hyper_log'))).toBe(true);
        expect(monitor.some(query => query.statement === 'INSERT')).toBe(true);
        expect(monitor.every(query => query.sentByApp)).toBe(true);
        // The reads of the extract by the overview are queries of the connection too
        expect(listed.some(query => query.queryType === 'overview' && query.sentByApp)).toBe(true);
        // The extract of another connection on the same Hyper has its own monitor, but not the queries of the connection
        const other = await queries('other');
        expect(other.some(query => query.queryType === 'monitor')).toBe(true);
        expect(other.some(query => query.query === 'SELECT 1 AS one')).toBe(false);
    }, 60_000);

    it('reads the rows after a row of the extract', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.query('SELECT 1 AS one');
        await poll('connection');
        const { queryEnds, clockOffsetMs } = logMetrics!.state.current.get(scoped('connection'))!;
        const read = async (afterRow: number) => await logMetrics!.query(
            scoped('connection'),
            queryEndsQuery(queryEnds!, clockOffsetMs!, { afterRow, since: Date.now() - 60_000 }),
        );
        const last = lastExtractRow(await read(0));
        await connection.query('SELECT 2 AS two');
        await poll('connection');
        const next = readQueryEnds(await read(last)).filter(query => query.queryType === 'user');
        expect(next.map(query => query.query)).toEqual(['SELECT 2 AS two']);
    }, 60_000);

    it('keeps the extract of a connection across monitors and closes it when forgotten', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.query('SELECT 1 AS before_restart');
        await poll('connection');
        await logMetrics!.forget(scoped('connection'));
        expect(logMetrics!.state.current.has(scoped('connection'))).toBe(false);

        // A new monitor, e.g. of a new app window, continues the extract
        await watch('connection');
        await connection.query('SELECT 2 AS after_restart');
        await poll('connection');
        const listed = (await ownQueries('connection')).map(query => query.query);
        expect(listed).toEqual(['SELECT 1 AS before_restart', 'SELECT 2 AS after_restart']);

        // The forgotten monitor closed the monitoring database, it can be deleted
        await logMetrics!.forget(scoped('connection'));
        const cleanup = await database!.connect();
        try {
            await cleanup.execute(`DROP DATABASE ${quoteIdentifier(databases.get(scoped('connection'))!)}`);
        } finally {
            await cleanup.close();
        }
        await expect(logMetrics!.query(scoped('connection'), 'SELECT 1')).rejects.toThrow(/not monitored/);
    }, 60_000);
});

describe('Hyper log metrics of resources', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let logMetrics: HyperLogMetrics | null = null;

    beforeAll(async () => {
        // The app settings log the resource usage every second
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath('dashql-log-metrics-resources-compute.hyper'),
            defaultDatabasePath: await testDatabasePath('dashql-log-metrics-resources-user.hyper'),
            terminateEngine: false,
        });
    }, 60_000);

    afterAll(async () => {
        await logMetrics?.stop();
        await database?.terminate();
        if (!sharedClient) await client?.terminate();
    });

    it('reads the resource samples of the Hyper process', async () => {
        const path = await testDatabasePath(`dashql-monitoring-${crypto.randomUUID()}.hyper`);
        logMetrics = new HyperLogMetrics({ logger: new TestLogger(), pollIntervalMs: 3_600_000, sink: async () => database!, prepareDatabase: async () => path });
        const before = Date.now();
        logMetrics.watch({ database: database!, sessions: true }, 'connection');
        expect(await logMetrics.opened('connection')).toBe(true);
        const { resourceMetrics, clockOffsetMs } = logMetrics.state.current.get('connection')!;
        const readSamples = async () => readResourceSamples(await logMetrics!.query('connection', resourceSamplesQuery(resourceMetrics!, clockOffsetMs!, { afterRow: 0, since: before })));
        // Poll until the first sample since the start of the test
        const deadline = performance.now() + 10_000;
        let samples = await readSamples();
        while (samples.length === 0) {
            if (performance.now() > deadline) throw new Error('the extract holds no resource sample after 10s');
            await new Promise(resolve => setTimeout(resolve, 250));
            await logMetrics.poll('connection');
            samples = await readSamples();
        }
        const after = Date.now();
        for (const sample of samples) {
            expect(sample.sampledAt).toBeGreaterThanOrEqual(before - 1_000);
            expect(sample.sampledAt).toBeLessThanOrEqual(after + 1_000);
            expect(sample.processMemoryMb).toBeGreaterThan(0);
            expect(sample.transactionMemoryMb).not.toBeNull();
            expect(sample.trackedMemoryMb).not.toBeNull();
            for (const load of [sample.overallLoad, sample.schedulerLoad, sample.memoryLoad]) {
                expect(load).toBeGreaterThanOrEqual(0);
                expect(load).toBeLessThanOrEqual(1);
            }
        }
    }, 60_000);
});

describe('Hyper log metrics without the log settings', () => {
    /// The engines of the test, terminated after it
    let clients: HyperDBClient[] = [];
    let databases: HyperDB[] = [];
    let logMetrics: HyperLogMetrics | null = null;
    /// The monitoring database of the test
    let monitoringPath = '';

    afterEach(async () => {
        await logMetrics?.stop();
        logMetrics = null;
        for (const database of databases) await database.terminate();
        databases = [];
        for (const client of clients) await client.terminate();
        clients = [];
    });

    /// Start a Hyper with the settings of the app, overridden by the given ones, and monitor its log
    async function startHyper(settings: HyperDBSettings): Promise<HyperDB> {
        monitoringPath = await testDatabasePath(`dashql-monitoring-${crypto.randomUUID()}.hyper`);
        const client = await createTestHyperDBClient(undefined, settings);
        clients.push(client);
        const database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath('dashql-log-metrics-settings-compute.hyper'),
            defaultDatabasePath: await testDatabasePath('dashql-log-metrics-settings-user.hyper'),
            terminateEngine: false,
        });
        databases.push(database);
        logMetrics = new HyperLogMetrics({
            logger: new TestLogger(),
            pollIntervalMs: 3_600_000,
            sink: async () => database,
            prepareDatabase: async () => monitoringPath,
        });
        return database;
    }

    it('leaves the monitor unavailable when the Hyper does not allow reading its log', async () => {
        const database = await startHyper({ experimental_hyper_introspection_functions: false });
        logMetrics!.watch({ database, sessions: true }, 'connection');
        expect(logMetrics!.state.current.get('connection')?.status).toBe(HyperLogStatus.Opening);
        expect(await logMetrics!.opened('connection')).toBe(false);

        const state = logMetrics!.state.current.get('connection')!;
        expect(state.status).toBe(HyperLogStatus.Unavailable);
        expect(state.error?.unreadable).toBe(true);
        expect(state.queryEnds).toBeNull();
        await logMetrics!.poll('connection');
        await expect(logMetrics!.query('connection', 'SELECT 1')).rejects.toThrow();

        // The connections of the user still work, with their client context
        const connection = await database.connect({ defaultDatabase: 'hyper', clientContext: connectionClientContext('connection') });
        expect((await connection.query('SELECT 42::integer AS answer')).get(0)?.answer).toBe(42);
        await connection.close();

        // The monitor created no extract
        const check = await database.connect();
        await expect(check.execute(`ATTACH DATABASE ${quoteIdentifier(monitoringPath)} AS monitoring`)).rejects.toThrow();
        await check.close();

        // A deleted connection drops the unavailable state
        logMetrics!.retain(new Set());
        expect(logMetrics!.state.current.has('connection')).toBe(false);
    }, 60_000);

    it('notices a Hyper that does not log its resource usage', async () => {
        const database = await startHyper({ log_resource_usage_interval: '0s' });
        logMetrics!.watch({ database, sessions: true }, 'connection');
        expect(await logMetrics!.opened('connection')).toBe(true);
        expect(logMetrics!.state.current.get('connection')?.resourceUsageLogged).toBeNull();
        await logMetrics!.poll('connection');

        const state = logMetrics!.state.current.get('connection')!;
        expect(state.status).toBe(HyperLogStatus.Open);
        expect(state.error).toBeNull();
        expect(state.resourceUsageLogged).toBe(false);
        // The queries are still extracted, e.g. of the monitor itself
        expect((await logMetrics!.query('connection', queryEndsQuery(state.queryEnds!, state.clockOffsetMs!))).numRows).toBeGreaterThan(0);
    }, 60_000);
});
