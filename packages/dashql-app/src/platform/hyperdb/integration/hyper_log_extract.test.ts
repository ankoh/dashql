import * as arrow from 'apache-arrow';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestHyperDBClient } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, quoteIdentifier, type HyperDBConnection, type HyperDBClient } from '../hyperdb_wasm.js';
import {
    HyperDBIncrementalExtract,
    type HyperDBIncrementalExtractOptions,
    type HyperDBIncrementalExtractSource,
    type HyperDBSourceDatabase,
} from '../hyperdb_incremental_extract.js';
import {
    HYPER_LOG_EVENTS_TABLE,
    HYPER_LOG_QUERY_ENDS_TABLE,
    HyperDBLogSource,
    hyperLogQueryEndsTable,
} from '../hyperdb_log_extract.js';

function toPlainObjects(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

async function ignoreCleanupFailure(cleanup: () => Promise<void>): Promise<void> {
    try {
        await cleanup();
    } catch {
        // Preserve the test failure that triggered cleanup.
    }
}

function uniqueTag(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '_')}`;
}

/// Run queries against missing tables, every one ends with a query-end-user-error event naming its table.
async function failQueries(connection: HyperDBConnection, tag: string, count: number): Promise<void> {
    for (let i = 0; i < count; ++i) {
        await expect(connection.query(`SELECT * FROM ${tag}_missing_${i}`)).rejects.toThrow();
    }
}

/// Run successful queries, every one ends with a query-end event containing the tag.
async function succeedQueries(connection: HyperDBConnection, tag: string, count: number): Promise<void> {
    for (let i = 0; i < count; ++i) {
        await connection.query(`SELECT ${i} AS ${tag}`);
    }
}

async function readNumber(connection: HyperDBConnection, sql: string): Promise<number> {
    const result = await connection.query(sql);
    return Number(result.getChild(result.schema.fields[0].name)?.get(0) ?? 0);
}

/// Count the user errors in the log scope of the connection, since it was connected.
async function countScopeUserErrors(connection: HyperDBConnection, currentSession = false): Promise<number> {
    return await readNumber(connection, `
        SELECT count(*) AS n
        FROM hyper_log(current_session := ${currentSession}, last_log_scope := true)
        WHERE k = 'query-end-user-error'
    `);
}

async function readSessionId(connection: HyperDBConnection): Promise<string> {
    const result = await connection.query("SELECT sess FROM hyper_log(current_session := true) WHERE sess <> '-' LIMIT 1");
    return result.getChild('sess')!.get(0) as string;
}

const READER_ALIAS = 'extract_reader';
const QUERY_ENDS = `${READER_ALIAS}.public.query_ends`;
const EVENTS = `${READER_ALIAS}.public.events`;

/// Count the extracted query ends of an outcome whose query text contains the tag.
async function countQueryEnds(connection: HyperDBConnection, outcome: string, tag: string): Promise<number> {
    return await readNumber(connection, `
        SELECT count(*) AS n FROM ${QUERY_ENDS} WHERE outcome = '${outcome}' AND query LIKE '%${tag}%'
    `);
}

/// Count the extracted user errors whose query text contains the tag.
function countUserErrors(connection: HyperDBConnection, tag: string): Promise<number> {
    return countQueryEnds(connection, 'query-end-user-error', tag);
}

describe('HyperDB Wasm log extract', () => {
    /// The client of the source Hyper whose log is extracted
    let engineClient: HyperDBClient;
    /// The client of a separate sink Hyper process that holds the extract file
    let sinkClient: HyperDBClient;
    let database: HyperDB | null = null;
    let sinkDatabase: HyperDB | null = null;
    let nextDatabase = 1;
    let extractPath: string;
    let extract: HyperDBIncrementalExtract | null = null;
    let reader: HyperDBConnection | null = null;

    beforeAll(async () => {
        // The source is not the shared Hyper, every new extract would backfill the log of all earlier test files
        [engineClient, sinkClient] = await Promise.all([createTestHyperDBClient(), createTestHyperDBClient()]);
        // The tests share the databases, they tag their queries and extract into files of their own
        database = await HyperDB.create(new HyperDBEngine(engineClient), {
            computeDatabasePath: `/mnt/fs/dashql-log-extract-${nextDatabase++}.hyper`,
            defaultDatabasePath: `/mnt/fs/dashql-log-extract-${nextDatabase++}.hyper`,
            terminateEngine: false,
        });
        sinkDatabase = await HyperDB.create(new HyperDBEngine(sinkClient), {
            computeDatabasePath: `/mnt/fs/dashql-log-sink-${nextDatabase++}.hyper`,
            defaultDatabasePath: `/mnt/fs/dashql-log-sink-${nextDatabase++}.hyper`,
            terminateEngine: false,
        });
    }, 60_000);

    beforeEach(() => {
        extractPath = `/mnt/fs/${uniqueTag('hyper_log_extract')}.hyper`;
    });

    afterEach(async () => {
        if (reader != null) {
            const connection = reader;
            reader = null;
            await ignoreCleanupFailure(async () => { await connection.execute(`DETACH DATABASE ${READER_ALIAS}`); });
            await connection.close();
        }
        if (extract != null) {
            const running = extract;
            extract = null;
            await running.stop();
        }
        const cleanup = await sinkDatabase!.connect();
        try {
            await ignoreCleanupFailure(async () => {
                await cleanup.execute(`DROP DATABASE IF EXISTS ${quoteIdentifier(extractPath)}`);
            });
        } finally {
            await cleanup.close();
        }
    });

    afterAll(async () => {
        await sinkDatabase?.terminate();
        sinkDatabase = null;
        await database?.terminate();
        database = null;
        await sinkClient?.terminate();
        await engineClient?.terminate();
    });

    /// Open an extract of the source log in the sink.
    async function openExtract(
        { sourceQuery, ...options }: Partial<HyperDBIncrementalExtractOptions> & { sourceQuery?: string } = {},
    ): Promise<HyperDBIncrementalExtract> {
        extract = await HyperDBIncrementalExtract.open({
            sourceDatabase: database!,
            source: new HyperDBLogSource(sourceQuery),
            sink: sinkDatabase!,
            databasePath: extractPath,
            tables: [HYPER_LOG_QUERY_ENDS_TABLE, HYPER_LOG_EVENTS_TABLE],
            ...options,
        });
        return extract;
    }

    /// A separate sink connection reading the extract file while the extractor writes it.
    async function openReader(): Promise<HyperDBConnection> {
        const connection = await sinkDatabase!.connect();
        await connection.execute(`ATTACH DATABASE ${quoteIdentifier(extractPath)} AS ${READER_ALIAS}`);
        reader = connection;
        return connection;
    }

    it('reads the log of the current session with named arguments', async () => {
        const connection = await database!.connect();
        try {
            await connection.query('SELECT 42 AS answer');
            const sample = await connection.query('SELECT * FROM hyper_log(current_session := true) LIMIT 1');
            expect(sample.schema.fields.map(field => field.name)).toEqual(expect.arrayContaining([
                'ts', 'pid', 'tid', 'sev', 'req', 'sess', 'ctx', 'k', 'v',
            ]));
            const elapsed = toPlainObjects(await connection.query(`
                SELECT (v->>'elapsed')::double precision AS elapsed
                FROM hyper_log(current_session := true)
                WHERE k = 'query-end'
            `));
            expect(elapsed.length).toBeGreaterThan(0);
            for (const row of elapsed) expect(row.elapsed).toBeGreaterThanOrEqual(0);
        } finally {
            await connection.close();
        }
    });

    it('starts the log scope of a new connection at its creation', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('fresh');
        let monitor: HyperDBConnection | null = null;
        try {
            await failQueries(worker, `${tag}_before`, 1);
            monitor = await database!.connect();
            expect(await countScopeUserErrors(monitor)).toBe(0);
            await failQueries(worker, `${tag}_after`, 1);
            expect(await countScopeUserErrors(monitor)).toBe(1);
        } finally {
            await monitor?.close();
            await worker.close();
        }
    });

    it('appends every log event exactly once', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('grow');
        try {
            await openExtract();
            const connection = await openReader();

            await failQueries(worker, `${tag}_a`, 2);
            await succeedQueries(worker, `${tag}_ok`, 2);
            expect((await extract!.poll()).appended).toBeGreaterThan(0);
            expect(await countUserErrors(connection, tag)).toBe(2);

            await failQueries(worker, `${tag}_b`, 1);
            await extract!.poll();
            expect(await countUserErrors(connection, tag)).toBe(3);
            expect(await countUserErrors(connection, `${tag}_a_missing_0`)).toBe(1);
            expect(await countQueryEnds(connection, 'query-end', `${tag}_ok`)).toBe(2);

            // Without new failures, a poll appends no further errors.
            await extract!.poll();
            expect(await countUserErrors(connection, tag)).toBe(3);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('writes typed rows into the configured tables', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('typed');
        try {
            await openExtract({
                tables: [HYPER_LOG_QUERY_ENDS_TABLE, {
                    name: 'user_errors',
                    query: `
                        SELECT ts, v::json->>'error-code' AS code, v::json->>'error-message' AS message
                        FROM log WHERE k = 'query-end-user-error'
                    `,
                }],
            });
            expect(extract!.schemas.user_errors).toEqual([
                { name: 'ts', type: 'timestamp' },
                { name: 'code', type: 'text' },
                { name: 'message', type: 'text' },
            ]);
            expect(extract!.schemas.query_ends).toContainEqual({ name: 'elapsed', type: 'double precision' });
            expect(extract!.schemas.query_ends).toContainEqual({ name: 'rows', type: 'bigint' });
            await succeedQueries(worker, tag, 1);
            await failQueries(worker, tag, 2);
            const transfer = await extract!.poll();
            expect(Object.keys(transfer.tables)).toEqual(['query_ends', 'user_errors']);
            expect(transfer.tables.user_errors).toBe(2);
            expect(transfer.tables.query_ends).toBeGreaterThanOrEqual(3);

            const connection = await openReader();
            expect(toPlainObjects(await connection.query(`
                SELECT code, message FROM ${READER_ALIAS}.public.user_errors WHERE message LIKE '%${tag}%' ORDER BY message
            `))).toEqual([
                { code: '42P01', message: `table "${tag}_missing_0" does not exist` },
                { code: '42P01', message: `table "${tag}_missing_1" does not exist` },
            ]);
            const [success] = toPlainObjects(await connection.query(`
                SELECT statement, elapsed, rows, error_code FROM ${QUERY_ENDS} WHERE outcome = 'query-end' AND query LIKE '%${tag}%'
            `));
            expect(success.statement).toBe('SELECT');
            expect(typeof success.elapsed).toBe('number');
            expect(success.rows).toBe(1n);
            expect(success.error_code).toBeNull();
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('selects the events with a source query', async () => {
        const kept = await database!.connect();
        const ignored = await database!.connect();
        const tag = uniqueTag('filter');
        try {
            const ignoredSession = await readSessionId(ignored);
            await openExtract({
                sourceQuery: `SELECT * FROM log WHERE sess IS DISTINCT FROM '${ignoredSession}' AND k LIKE 'query-%'`,
            });
            await failQueries(kept, `${tag}_kept`, 1);
            await failQueries(ignored, `${tag}_ignored`, 1);
            await extract!.poll();

            const connection = await openReader();
            expect(await countUserErrors(connection, `${tag}_kept`)).toBe(1);
            expect(await countUserErrors(connection, `${tag}_ignored`)).toBe(0);
            expect(await readNumber(connection, `SELECT count(*) AS n FROM ${EVENTS} WHERE k NOT LIKE 'query-%'`)).toBe(0);
            expect(await readNumber(connection, `SELECT count(*) AS n FROM ${EVENTS} WHERE sess = '${ignoredSession}'`)).toBe(0);
        } finally {
            await ignored.close();
            await kept.close();
        }
    }, 60_000);

    it('rejects invalid queries before reading events', async () => {
        await expect(openExtract({ sourceQuery: 'SELECT ts, k FROM log' }))
            .rejects.toThrow(/source query must return the source columns: missing pid/);
        await expect(openExtract({ sourceQuery: 'SELECT *, 1 AS extra FROM log' }))
            .rejects.toThrow(/unexpected extra/);
        await expect(openExtract({ sourceQuery: 'SELECT * FROM nope' }))
            .rejects.toThrow(/invalid source query/);
        await expect(openExtract({ tables: [{ name: 'broken', query: 'SELECT nope FROM log' }] }))
            .rejects.toThrow(/invalid query of the extract table broken/);
        await expect(openExtract({ tables: [{ name: 'twice', query: 'SELECT ts, ts FROM log' }] }))
            .rejects.toThrow(/returns the column ts twice/);
        await expect(openExtract({ tables: [{ name: 'internal', query: 'SELECT 1 AS __row FROM log' }] }))
            .rejects.toThrow(/column name __row of the extract table internal is reserved/);
        await expect(openExtract({ tables: [{ name: 'limited', query: 'SELECT ts FROM log', maxRows: 0 }] }))
            .rejects.toThrow(/row limit of the extract table limited must be a positive integer/);
        await expect(openExtract({ tables: [{ name: 'aged', query: 'SELECT ts FROM log', maxAgeMs: 0 }] }))
            .rejects.toThrow(/age limit of the extract table aged must be positive/);
        await expect(openExtract({ tables: [{ name: 'timeless', query: 'SELECT k FROM log', maxAgeMs: 1_000 }] }))
            .rejects.toThrow(/extract table timeless needs the watermark column ts for its age limit/);
        extract = null;
    }, 60_000);

    it('rebuilds an extract whose table no longer matches its query', async () => {
        const kept = { name: 'kept', query: 'SELECT ts FROM log' };
        await openExtract({ tables: [{ name: 'changing', query: 'SELECT ts, k FROM log' }, kept] });
        await extract!.stop();
        extract = null;
        const reasons: string[] = [];
        const tables = [{ name: 'changing', query: 'SELECT ts, k, v FROM log' }, kept];
        await openExtract({ tables, onRebuild: reason => reasons.push(reason) });
        expect(reasons).toEqual([expect.stringMatching(/the extract table changing has the columns \(ts timestamp, k text\)/)]);
        expect(extract!.schemas.changing.map(({ name }) => name)).toEqual(['ts', 'k', 'v']);
        // The backfill read the log again, both tables hold each event once
        const connection = await openReader();
        const changing = await readNumber(connection, `SELECT count(*) AS n FROM ${READER_ALIAS}.public.changing`);
        expect(changing).toBeGreaterThan(0);
        expect(await readNumber(connection, `SELECT count(*) AS n FROM ${READER_ALIAS}.public.kept`)).toBe(changing);
        // The rebuilt extract opens again without a rebuild
        await extract!.stop();
        extract = null;
        await openExtract({ tables, onRebuild: reason => reasons.push(reason) });
        expect(reasons.length).toBe(1);
    }, 60_000);

    it('computes operational metrics over the extract', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('metrics');
        try {
            await openExtract();
            await succeedQueries(worker, tag, 3);
            await failQueries(worker, tag, 2);
            await extract!.poll();

            const connection = await openReader();
            const [metrics] = toPlainObjects(await connection.query(`
                SELECT
                    count(*) FILTER (WHERE outcome = 'query-end')              AS succeeded,
                    count(*) FILTER (WHERE outcome = 'query-end-user-error')   AS user_errors,
                    count(*) FILTER (WHERE outcome = 'query-end-system-error') AS system_errors,
                    count(*) FILTER (WHERE outcome = 'query-end-canceled')     AS canceled,
                    avg(elapsed) FILTER (WHERE outcome = 'query-end')          AS avg_elapsed_seconds,
                    max(elapsed)                                               AS max_elapsed_seconds
                FROM ${QUERY_ENDS}
                WHERE query LIKE '%${tag}%'
            `));
            expect(Number(metrics.succeeded)).toBe(3);
            expect(Number(metrics.user_errors)).toBe(2);
            expect(Number(metrics.system_errors)).toBe(0);
            expect(Number(metrics.canceled)).toBe(0);
            expect(metrics.avg_elapsed_seconds).toBeGreaterThan(0);
            expect(metrics.max_elapsed_seconds).toBeGreaterThanOrEqual(metrics.avg_elapsed_seconds as number);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('recovers the events since the last poll after a reconnect', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('reconnect');
        try {
            await openExtract();
            await failQueries(worker, `${tag}_polled`, 1);
            await extract!.poll();
            // Written after the last poll of the first connection.
            await failQueries(worker, `${tag}_unpolled`, 1);
            await extract!.stop();
            extract = null;
            // Written while no monitor connection exists.
            await failQueries(worker, `${tag}_disconnected`, 2);

            await openExtract();
            const connection = await openReader();
            const count = (suffix: string) => countUserErrors(connection, `${tag}_${suffix}`);
            expect(await count('polled')).toBe(1);
            expect(await count('unpolled')).toBe(1);
            expect(await count('disconnected')).toBe(2);

            // The first poll reads events of the backfill again and skips them.
            await failQueries(worker, `${tag}_reconnected`, 1);
            await extract!.poll();
            expect(await count('polled')).toBe(1);
            expect(await count('unpolled')).toBe(1);
            expect(await count('disconnected')).toBe(2);
            expect(await count('reconnected')).toBe(1);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('backfills a reconnect from the timestamp watermark', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('watermark');
        try {
            const first = await openExtract();
            // An empty extract has no watermark and backfills all retained events.
            expect(first.backfill.appended).toBeGreaterThan(0);
            await succeedQueries(worker, tag, 20);
            await first.poll();
            await first.stop();
            extract = null;
            await failQueries(worker, `${tag}_gap`, 1);

            const retained = await readNumber(worker, `
                SELECT count(*) AS n FROM hyper_log(current_session := false, last_log_scope := false)
            `);
            const second = await openExtract({ backfillOverlapMs: 0 });
            expect(second.backfill.fetched).toBeGreaterThan(0);
            expect(second.backfill.fetched).toBeLessThan(retained);
            expect(second.backfill.appended).toBeGreaterThan(0);

            const connection = await openReader();
            expect(await countUserErrors(connection, `${tag}_gap`)).toBe(1);
            expect(await countQueryEnds(connection, 'query-end', tag)).toBe(20);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('stores every event once across repeated reconnects', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('repeat');
        try {
            for (let i = 0; i < 3; ++i) {
                await openExtract();
                await succeedQueries(worker, `${tag}_${i}`, 2);
                await failQueries(worker, `${tag}_${i}`, 1);
                await extract!.poll();
                await failQueries(worker, `${tag}_${i}_tail`, 1);
                await extract!.stop();
                extract = null;
            }
            await openExtract();

            const connection = await openReader();
            expect(await countUserErrors(connection, tag)).toBe(6);
            expect(await countQueryEnds(connection, 'query-end', tag)).toBe(6);
            for (const table of [EVENTS, QUERY_ENDS]) {
                expect(await readNumber(connection, `
                    SELECT count(*) AS n FROM (SELECT * FROM ${table} GROUP BY ALL HAVING count(*) > 1) duplicates
                `)).toBe(0);
            }
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('extracts its own reads once', async () => {
        await openExtract();
        const connection = await openReader();
        // Every read is logged after its scan, the next reader reads it with the next poll
        for (let i = 0; i < 4; ++i) await extract!.poll();
        const reads = await readNumber(connection, `
            SELECT count(*) AS n FROM ${QUERY_ENDS} WHERE query LIKE '%last_log_scope := true%' AND statement = 'SELECT'
        `);
        expect(reads).toBeGreaterThanOrEqual(3);
        expect(await readNumber(connection, `
            SELECT count(*) AS n FROM (SELECT * FROM ${EVENTS} GROUP BY ALL HAVING count(*) > 1) duplicates
        `)).toBe(0);
    }, 60_000);

    it('extracts the events during a poll with the next poll', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('handover');
        let armed = false;
        let reads = 0;
        // Log an event right after the scan of every read, before the poll replaces its reader
        const sourceDatabase: HyperDBSourceDatabase = {
            connect: async options => {
                const connection = await database!.connect(options);
                return {
                    query: async (sql, abort) => {
                        const result = await connection.query(sql, abort);
                        if (armed && sql.includes('last_log_scope := true')) await failQueries(worker, `${tag}_${reads++}`, 1);
                        return result;
                    },
                    execute: (statement, abort) => connection.execute(statement, abort),
                    close: () => connection.close(),
                };
            },
        };
        try {
            await openExtract({ sourceDatabase });
            armed = true;
            for (let i = 0; i < 3; ++i) await extract!.poll();
            const connection = await openReader();
            expect(reads).toBe(3);
            expect(await countUserErrors(connection, `${tag}_0`)).toBe(1);
            expect(await countUserErrors(connection, `${tag}_1`)).toBe(1);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('extracts every event from the watermark without sessions', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('sessionless');
        try {
            await openExtract({ source: new HyperDBLogSource(undefined, false) });
            await failQueries(worker, `${tag}_a`, 2);
            await extract!.poll();
            await failQueries(worker, `${tag}_b`, 1);
            await extract!.poll();
            await extract!.poll();
            const connection = await openReader();
            expect(await countUserErrors(connection, `${tag}_a`)).toBe(2);
            expect(await countUserErrors(connection, `${tag}_b`)).toBe(1);
            expect(await readNumber(connection, `
                SELECT count(*) AS n FROM (SELECT * FROM ${EVENTS} GROUP BY ALL HAVING count(*) > 1) duplicates
            `)).toBe(0);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('reads the clock offset of the log', async () => {
        // 0 - avoids the -0 of UTC
        const offset = 0 - new Date().getTimezoneOffset() * 60_000;
        for (const scoped of [true, false]) {
            const connection = await database!.connect();
            try {
                expect(await new HyperDBLogSource(undefined, scoped).readClockOffset(connection)).toBe(offset);
            } finally {
                await connection.close();
            }
        }
    }, 60_000);

    it('attributes the queries of its connections by their client context', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('context');
        try {
            await openExtract({
                tables: [hyperLogQueryEndsTable([{ name: 'client_role', path: ['role'] }]), HYPER_LOG_EVENTS_TABLE],
                clientContext: { role: 'monitor' },
            });
            await succeedQueries(worker, tag, 1);
            for (let i = 0; i < 2; ++i) await extract!.poll();
            const connection = await openReader();
            expect(await readNumber(connection, `
                SELECT count(*) AS n FROM ${QUERY_ENDS} WHERE query LIKE '%${tag}%' AND client_role IS NULL
            `)).toBe(1);
            // The sink is another Hyper, the source log only holds the reads of the readers
            expect(await readNumber(connection, `
                SELECT count(*) AS n FROM ${QUERY_ENDS} WHERE query LIKE '%last_log_scope := true%' AND client_role = 'monitor'
            `)).toBeGreaterThanOrEqual(1);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('names the tables of an extract file by its alias', async () => {
        await openExtract({ databaseAlias: 'monitoring' });
        expect(extract!.tableName('query_ends')).toBe('"monitoring"."public"."query_ends"');
        const connection = await openReader();
        expect(await readNumber(connection, `SELECT count(*) AS n FROM ${QUERY_ENDS}`)).toBeGreaterThanOrEqual(0);
    }, 60_000);

    it('extracts into a schema of the compute database of the sink', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('compute');
        try {
            await openExtract({ databasePath: undefined, schema: 'hyper_log' });
            expect(extract!.tableName('query_ends')).toBe('"__dashql_compute"."hyper_log"."query_ends"');
            await failQueries(worker, tag, 2);
            await extract!.poll();
            // A compute connection of the sink reads the extract without attaching it
            const compute = await sinkDatabase!.connect({ pooled: true });
            try {
                expect(await readNumber(compute, `
                    SELECT count(*) AS n FROM hyper_log.query_ends WHERE outcome = 'query-end-user-error' AND query LIKE '%${tag}%'
                `)).toBe(2);
            } finally {
                await compute.close();
            }
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('polls periodically until stopped', async () => {
        const worker = await database!.connect();
        const tag = uniqueTag('timer');
        const errors: unknown[] = [];
        let transfers = 0;
        try {
            await openExtract({
                intervalMs: 50,
                onTransfer: () => { ++transfers; },
                onError: error => errors.push(error),
            });
            const connection = await openReader();
            extract!.start();
            await failQueries(worker, tag, 1);

            const deadline = performance.now() + 10_000;
            while (await countUserErrors(connection, tag) === 0) {
                if (performance.now() > deadline) throw new Error('the extract did not pick up the error in time');
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            await extract!.stop();
            extract = null;
            expect(errors).toEqual([]);
            expect(transfers).toBeGreaterThan(0);

            const rows = await readNumber(connection, `SELECT count(*) AS n FROM ${EVENTS}`);
            await failQueries(worker, `${tag}_late`, 1);
            await new Promise(resolve => setTimeout(resolve, 200));
            expect(await readNumber(connection, `SELECT count(*) AS n FROM ${EVENTS}`)).toBe(rows);
        } finally {
            await worker.close();
        }
    }, 60_000);

    it('keeps the rows of an age before the newest row', async () => {
        const writer = await database!.connect();
        const sourceTable = uniqueTag('aged');
        try {
            await writer.execute(`CREATE TABLE ${sourceTable} (ts TIMESTAMP, id INTEGER)`);
            await writer.execute(`INSERT INTO ${sourceTable} VALUES
                ('2026-10-23 10:00:00', 1), ('2026-10-23 10:00:01', 2), ('2026-10-23 10:00:02', 3)`);
            const source: HyperDBIncrementalExtractSource = {
                relation: 'changes',
                columns: [{ name: 'ts', type: 'TIMESTAMP' }, { name: 'id', type: 'INTEGER' }],
                watermarkColumn: 'ts',
                backfillQuery: since => `SELECT ts, id FROM ${sourceTable}${since == null ? '' : ` WHERE ${since}`}`,
            };
            extract = await HyperDBIncrementalExtract.open({
                sourceDatabase: database!,
                source,
                sink: sinkDatabase!,
                databasePath: extractPath,
                tables: [{ name: 'recent', query: 'SELECT ts, id FROM changes', maxAgeMs: 1_500 }],
                backfillOverlapMs: 1_000,
            });
            // The rows older than 1.5s before 10:00:02 are deleted
            expect(extract.backfill.deleted).toEqual({ recent: 1 });
            await writer.execute(`INSERT INTO ${sourceTable} VALUES ('2026-10-23 10:00:04', 4)`);
            expect((await extract.poll()).deleted).toEqual({ recent: 2 });

            const connection = await openReader();
            expect(toPlainObjects(await connection.query(`SELECT id FROM ${READER_ALIAS}.public.recent ORDER BY id`)))
                .toEqual([{ id: 4 }]);
        } finally {
            await writer.close();
        }
    }, 60_000);

    it('extracts an append-only table by its watermark', async () => {
        const writer = await database!.connect();
        const sourceTable = uniqueTag('append_only');
        try {
            await writer.execute(`CREATE TABLE ${sourceTable} (ts TIMESTAMP, id INTEGER, payload TEXT)`);
            await writer.execute(`INSERT INTO ${sourceTable} VALUES
                ('2026-10-23 10:00:00', 1, 'a'), ('2026-10-23 10:00:01', 2, 'b'), ('2026-10-23 10:00:02', 3, 'c')`);
            // Without an update query, every poll is a backfill from the watermark.
            const source: HyperDBIncrementalExtractSource = {
                relation: 'changes',
                columns: [
                    { name: 'ts', type: 'TIMESTAMP' },
                    { name: 'id', type: 'INTEGER' },
                    { name: 'payload', type: 'TEXT' },
                ],
                watermarkColumn: 'ts',
                backfillQuery: since => `SELECT ts, id, payload FROM ${sourceTable}${since == null ? '' : ` WHERE ${since}`}`,
            };
            extract = await HyperDBIncrementalExtract.open({
                sourceDatabase: database!,
                source,
                sink: sinkDatabase!,
                databasePath: extractPath,
                tables: [
                    { name: 'copy', query: 'SELECT id, upper(payload) AS payload FROM changes' },
                    { name: 'latest', query: 'SELECT ts, id FROM changes', maxRows: 2 },
                ],
                backfillOverlapMs: 1_000,
            });
            expect(extract.backfill).toEqual({
                fetched: 3, appended: 3, tables: { copy: 3, latest: 3 }, deleted: { latest: 1 },
            });
            expect(extract.schemas.copy).toEqual([{ name: 'id', type: 'integer' }, { name: 'payload', type: 'text' }]);

            // A row with the watermark ts, a newer row, and a late row before the overlap.
            await writer.execute(`INSERT INTO ${sourceTable} VALUES
                ('2026-10-23 10:00:02', 4, 'd'), ('2026-10-23 10:00:03', 5, 'e'), ('2026-10-23 09:00:00', 6, 'late')`);
            // The poll reads the rows from 10:00:01 again and skips 2 and 3.
            expect(await extract.poll()).toEqual({
                fetched: 4, appended: 2, tables: { copy: 2, latest: 2 }, deleted: { latest: 2 },
            });
            // The rows from 10:00:02 are read again, two of them share the ts.
            expect(await extract.poll()).toEqual({
                fetched: 3, appended: 0, tables: { copy: 0, latest: 0 }, deleted: { latest: 0 },
            });

            const connection = await openReader();
            expect(toPlainObjects(await connection.query(`SELECT id, payload FROM ${READER_ALIAS}.public.copy ORDER BY id`)))
                .toEqual([
                    { id: 1, payload: 'A' },
                    { id: 2, payload: 'B' },
                    { id: 3, payload: 'C' },
                    { id: 4, payload: 'D' },
                    { id: 5, payload: 'E' },
                ]);
            // The row limit keeps the newest rows, numbered by the watermark within a transfer.
            expect(toPlainObjects(await connection.query(`
                SELECT "__row" AS row, id FROM ${READER_ALIAS}.public.latest ORDER BY "__row"
            `))).toEqual([{ row: 4n, id: 4 }, { row: 5n, id: 5 }]);
        } finally {
            await ignoreCleanupFailure(async () => { await writer.execute(`DROP TABLE ${sourceTable}`); });
            await writer.close();
        }
    }, 60_000);
});
