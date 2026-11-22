import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { createTestHyperDBClient, testDatabasePath } from '../../tests/hyperdb_test_client.js';
import { HyperDB, type HyperDBClient, type HyperDBConnection, type HyperDBSettings } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import type { HyperDBSourceDatabase } from '../shared/hyperdb_incremental_extract.js';
import { quoteIdentifier } from '@akohn/dashql/platform/utils/sql_quote';
import {
    HyperLogMetrics,
    HyperLogStatus,
    hyperLogClientContext,
    lastExtractRow,
    queryEndsQuery,
    readQueryEnds,
    readResourceSamples,
    resourceSamplesQuery,
    type HyperQueryEnd,
} from './hyper_log_metrics.js';

/// A Hyper whose reads of the log time out while a test asks for it, like a Hyper under load
function timingOut(database: HyperDB, timeOut: () => boolean): HyperDBSourceDatabase {
    return {
        connect: async options => {
            const connection = await database.connect(options);
            return {
                query: async (sql, abort) => {
                    if (sql.includes('hyper_log(') && timeOut()) throw new Error('Timed out while flushing the structured log.');
                    return await connection.query(sql, abort);
                },
                execute: (statement, abort) => connection.execute(statement, abort),
                close: () => connection.close(),
            };
        },
    };
}

/// How long a test waits for the log. Hyper may log the end of a query after its result, and a read may time out.
const LOG_WAIT = { timeout: 30_000, interval: 250 };

/// Is a query a statement of the app on the sessions? HyperDB attaches the default database.
function isSetup(query: HyperQueryEnd): boolean {
    return query.statement === 'ATTACH';
}

describe('Hyper log metrics', () => {
    let client: HyperDBClient | null = null;
    let database: HyperDB | null = null;
    let logMetrics: HyperLogMetrics | null = null;
    let connections: HyperDBConnection[] = [];
    let nextDatabase = 1;
    /// The tests share the log of one Hyper and every extract backfills it, the connection ids are unique per test.
    /// The Hyper is not the shared one of the tests, every extract would backfill the log of all earlier test files.
    let run = '';
    const scoped = (connectionId: string) => `${connectionId}@${run}`;
    /// The monitoring databases of the connections of a test
    const databases = new Map<string, string>();

    beforeAll(async () => {
        // The settings of the app with the resource usage logged every second, which the monitor reads
        client = await createTestHyperDBClient(undefined, { log_resource_usage_interval: '1s', log_resource_usage_always: 1 });
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
    });

    /// Monitor the log of a connection. Poll explicitly by default, the timer would race with the assertions.
    function createLogMetrics(connectionId: string, options: { source?: HyperDBSourceDatabase; pollIntervalMs?: number; openRetryMs?: number } = {}): HyperLogMetrics {
        const scopedId = scoped(connectionId);
        logMetrics = new HyperLogMetrics({
            logger: new TestLogger(),
            connectionId: scopedId,
            source: options.source ?? database!,
            sink: database!,
            pollIntervalMs: options.pollIntervalMs ?? 3_600_000,
            openRetryMs: options.openRetryMs,
            prepareDatabase: async () => {
                let path = databases.get(scopedId);
                if (path == null) {
                    path = await testDatabasePath(`dashql-monitoring-${crypto.randomUUID()}.hyper`);
                    databases.set(scopedId, path);
                }
                return path;
            },
        });
        return logMetrics;
    }

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
        await client?.terminate();
        client = null;
    });

    /// Monitor the log of a connection and wait until the extract is open
    async function watch(connectionId: string): Promise<void> {
        const metrics = createLogMetrics(connectionId);
        expect(await metrics.opened(), JSON.stringify(metrics.state.current.error)).toBe(true);
    }

    /// A connection of the user that the client context attributes to a connection
    async function connect(connectionId: string | null): Promise<HyperDBConnection> {
        const connection = await database!.connect({
            defaultDatabase: 'hyper',
            clientContext: connectionId == null ? undefined : hyperLogClientContext(scoped(connectionId), 'user'),
        });
        connections.push(connection);
        return connection;
    }

    /// Poll the log until a check passes, the last failure of the check fails the test.
    /// One poll is not enough: the log may not hold the end of a query yet right after its result.
    async function pollUntil(check: () => Promise<void>): Promise<void> {
        await vi.waitFor(async () => {
            await logMetrics!.poll();
            await check();
        }, LOG_WAIT);
    }

    /// Poll the log until the extract holds exactly these own queries
    async function pollUntilOwn(expected: string[]): Promise<void> {
        await pollUntil(async () => {
            expect((await ownQueries()).map(query => query.query)).toEqual(expected);
        });
    }

    /// The finished queries in the extract, read like the dashboard
    async function queries(): Promise<HyperQueryEnd[]> {
        return readQueryEnds(await logMetrics!.query(queryEndsQuery(logMetrics!.state.current.queryEnds!)));
    }

    /// The finished queries without the queries of the app on the extract and the setup of the sessions
    async function ownQueries(): Promise<HyperQueryEnd[]> {
        return (await queries())
            .filter(query => query.queryType !== 'monitor' && query.queryType !== 'overview' && !isSetup(query));
    }

    it('extracts the finished queries of a connection by its client context', async () => {
        await watch('first');
        const first = await connect('first');
        const second = await connect('second');
        const unattributed = await connect(null);

        const before = Date.now();
        await first.query('SELECT sum(i) AS s FROM generate_series(1, 100000) g(i)');
        await expect(first.query('SELECT * FROM query_log_missing_table')).rejects.toThrow();
        await second.query('SELECT 1 AS one');
        await unattributed.query('SELECT 2 AS two');
        await pollUntil(async () => {
            expect(await ownQueries()).toHaveLength(2);
            // The setup of a session runs with its client context
            expect((await queries()).filter(query => isSetup(query) && query.queryType === 'user')).toHaveLength(1);
        });
        const after = Date.now();

        // Not by their order, a query may log its end after the next query started
        const firstQueries = await ownQueries();
        for (const query of firstQueries) expect([query.queryType, query.sentByApp]).toEqual(['user', false]);
        const succeeded = firstQueries.find(query => query.succeeded)!;
        const failed = firstQueries.find(query => !query.succeeded)!;
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
        // The ends are in milliseconds since the epoch, the log writes the local time of the page
        for (const query of firstQueries) {
            expect(query.endedAt).toBeGreaterThanOrEqual(before - 1_000);
            expect(query.endedAt).toBeLessThanOrEqual(after + 1_000);
        }
    }, 60_000);

    it('extracts the queries of pooled connections by their client context', async () => {
        await watch('connection');
        const channel = await connect('connection');
        const compute = await database!.connect({ pooled: true, clientContext: hyperLogClientContext(scoped('connection'), 'sqlframe') });
        await compute.query('SELECT 3 AS sqlframe_query');
        await expect(compute.query('SELECT * FROM sqlframe_missing_table')).rejects.toThrow();
        await compute.close();
        const other = await database!.connect({ pooled: true, clientContext: hyperLogClientContext(scoped('other'), 'sqlframe') });
        await other.query('SELECT 4 AS other_query');
        await other.close();
        await channel.query('SELECT 1 AS one');

        await pollUntil(async () => {
            // Not by their order, a query may log its end after the next query started
            const own = (await ownQueries()).map(query => [query.query, query.sentByApp, query.succeeded]);
            expect(own).toHaveLength(3);
            expect(own).toEqual(expect.arrayContaining([
                ['SELECT 3 AS sqlframe_query', true, true],
                ['SELECT * FROM sqlframe_missing_table', true, false],
                ['SELECT 1 AS one', false, true],
            ]));
            // The attaching of the compute database runs with the client context of its session
            expect((await queries()).filter(query => isSetup(query) && query.queryType === 'sqlframe')).toHaveLength(1);
        });
    }, 60_000);

    it('reads the processed rows of the queries', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.execute('CREATE TABLE log_metrics_scan AS SELECT i FROM generate_series(1, 1000) g(i)');
        await connection.query('SELECT count(*) AS n FROM log_metrics_scan');
        await pollUntil(async () => {
            const scan = (await queries()).find(query => query.query?.includes('count(*)'));
            expect(scan?.processedRows).toBe(1000);
        });
    }, 60_000);

    it('extracts the queries of the own monitor and notifies new rows', async () => {
        await watch('connection');
        const connection = await connect('connection');
        const transfers = logMetrics!.state.current.transfers;
        await connection.query('SELECT 1 AS one');
        await pollUntil(async () => {
            expect(logMetrics!.state.current.transfers).toBeGreaterThan(transfers);
            expect((await ownQueries()).map(query => query.query)).toEqual(['SELECT 1 AS one']);
            // Every read of the log is read by the next reader. The sink writes the extract.
            const listed = await queries();
            const monitor = listed.filter(query => query.queryType === 'monitor');
            expect(monitor.some(query => query.query?.includes('hyper_log'))).toBe(true);
            expect(monitor.some(query => query.statement === 'INSERT')).toBe(true);
            expect(monitor.every(query => query.sentByApp)).toBe(true);
            // The reads of the extract by the dashboard are queries of the connection too
            expect(listed.some(query => query.queryType === 'overview' && query.sentByApp)).toBe(true);
        });
    }, 60_000);

    it('reads the rows after a row of the extract', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.query('SELECT 1 AS one');
        await pollUntilOwn(['SELECT 1 AS one']);
        const queryEnds = logMetrics!.state.current.queryEnds!;
        const read = async (afterRow: number) => await logMetrics!.query(queryEndsQuery(queryEnds, { afterRow, since: Date.now() - 60_000 }));
        const last = lastExtractRow(await read(0));
        await connection.query('SELECT 2 AS two');
        await pollUntil(async () => {
            const next = readQueryEnds(await read(last)).filter(query => query.queryType === 'user' && !isSetup(query));
            expect(next.map(query => query.query)).toEqual(['SELECT 2 AS two']);
        });
    }, 60_000);

    it('opens the extract after a read of the log timed out', async () => {
        let timeouts = 1;
        const metrics = createLogMetrics('connection', { source: timingOut(database!, () => timeouts-- > 0) });
        expect(await metrics.opened()).toBe(true);
        expect(timeouts).toBeLessThan(0);
        expect(metrics.state.current.status).toBe(HyperLogStatus.Open);
    }, 60_000);

    it('leaves the monitor unavailable while the reads of the log keep timing out', async () => {
        // Every read fails here, so the pauses cannot change the outcome. The other tests keep the pauses of the app, they
        // let a read of the log that really timed out on a loaded machine recover.
        const metrics = createLogMetrics('connection', { source: timingOut(database!, () => true), openRetryMs: 1 });
        expect(await metrics.opened()).toBe(false);
        const state = metrics.state.current;
        expect(state.status).toBe(HyperLogStatus.Unavailable);
        expect(state.error?.unreadable).toBe(false);
        expect(state.error?.message).toContain('Timed out while flushing');
    }, 60_000);

    it('keeps polling after a read of the log timed out', async () => {
        let timeouts = 0;
        const metrics = createLogMetrics('connection', { source: timingOut(database!, () => timeouts-- > 0), pollIntervalMs: 50 });
        expect(await metrics.opened()).toBe(true);
        const connection = await connect('connection');

        // A poll of the timer times out, and the next one reads the events
        timeouts = 3;
        await connection.query('SELECT 1 AS timed_out');
        await vi.waitFor(async () => {
            expect((await ownQueries()).map(query => query.query)).toEqual(['SELECT 1 AS timed_out']);
        }, LOG_WAIT);
        expect(timeouts).toBeLessThanOrEqual(0);
        expect(metrics.state.current.status).toBe(HyperLogStatus.Open);

        // An explicit poll does not fail either
        timeouts = 1;
        await metrics.poll();
        expect(metrics.state.current.status).toBe(HyperLogStatus.Open);
    }, 60_000);

    it('keeps the extract across monitors and closes it when stopped', async () => {
        await watch('connection');
        const connection = await connect('connection');
        await connection.query('SELECT 1 AS before_restart');
        await pollUntilOwn(['SELECT 1 AS before_restart']);
        await logMetrics!.stop();

        // A new monitor, e.g. of a new page, continues the extract
        await watch('connection');
        await connection.query('SELECT 2 AS after_restart');
        await pollUntilOwn(['SELECT 1 AS before_restart', 'SELECT 2 AS after_restart']);

        // The stopped monitor closed the monitoring database, it can be deleted
        await logMetrics!.stop();
        const cleanup = await database!.connect();
        try {
            await cleanup.execute(`DROP DATABASE ${quoteIdentifier(databases.get(scoped('connection'))!)}`);
        } finally {
            await cleanup.close();
        }
        await expect(logMetrics!.query('SELECT 1')).rejects.toThrow(/stopped/);
    }, 60_000);

    it('reads the resource samples of the Hyper process', async () => {
        const before = Date.now();
        await watch('connection');
        const resourceMetrics = logMetrics!.state.current.resourceMetrics!;
        const readSamples = async () => readResourceSamples(await logMetrics!.query(resourceSamplesQuery(resourceMetrics, { afterRow: 0, since: before })));
        // Poll until the first sample since the start of the test
        let samples: Awaited<ReturnType<typeof readSamples>> = [];
        await pollUntil(async () => {
            samples = await readSamples();
            expect(samples.length, 'the resource samples in the extract').toBeGreaterThan(0);
        });
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
            connectionId: 'connection',
            source: database,
            sink: database,
            pollIntervalMs: 3_600_000,
            prepareDatabase: async () => monitoringPath,
        });
        return database;
    }

    it('leaves the monitor unavailable when the Hyper does not allow reading its log', async () => {
        const database = await startHyper({ experimental_hyper_introspection_functions: false });
        expect(logMetrics!.state.current.status).toBe(HyperLogStatus.Opening);
        expect(await logMetrics!.opened()).toBe(false);

        const state = logMetrics!.state.current;
        expect(state.status).toBe(HyperLogStatus.Unavailable);
        expect(state.error?.unreadable).toBe(true);
        expect(state.queryEnds).toBeNull();
        await logMetrics!.poll();
        await expect(logMetrics!.query('SELECT 1')).rejects.toThrow();

        // The connections of the user still work, with their client context
        const connection = await database.connect({ defaultDatabase: 'hyper', clientContext: hyperLogClientContext('connection', 'user') });
        expect((await connection.query('SELECT 42::integer AS answer')).get(0)?.answer).toBe(42);
        await connection.close();

        // The monitor created no extract
        const check = await database.connect();
        await expect(check.execute(`ATTACH DATABASE ${quoteIdentifier(monitoringPath)} AS monitoring`)).rejects.toThrow();
        await check.close();
    }, 60_000);

    it('notices a Hyper that does not log its resource usage', async () => {
        await startHyper({ log_resource_usage_interval: '0s' });
        expect(await logMetrics!.opened()).toBe(true);
        expect(logMetrics!.state.current.resourceUsageLogged).toBeNull();
        await vi.waitFor(async () => {
            await logMetrics!.poll();
            const state = logMetrics!.state.current;
            expect(state.status).toBe(HyperLogStatus.Open);
            expect(state.error).toBeNull();
            expect(state.resourceUsageLogged).toBe(false);
            // The queries are still extracted, e.g. of the monitor itself
            expect((await logMetrics!.query(queryEndsQuery(state.queryEnds!))).numRows).toBeGreaterThan(0);
        }, LOG_WAIT);
    }, 60_000);
});
