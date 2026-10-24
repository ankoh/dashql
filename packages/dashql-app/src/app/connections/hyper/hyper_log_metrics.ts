import type * as arrow from 'apache-arrow';

import type { EmbeddedConnection, EmbeddedDatabase } from '../../../platform/database/embedded_database.js';
import type { HyperDBExtractState } from '../../../platform/hyperdb/hyperdb_incremental_extract.js';
import { HyperDBLogSource, hyperLogValue, readHyperSessionId } from '../../../platform/hyperdb/hyperdb_log_extract.js';
import { HYPER_LOG_INTERNAL_QUERY_TAG } from '../../../platform/hyperdb/hyperdb_wasm.js';
import type { Logger } from '../../../platform/logger/logger.js';
import { stringifyError } from '../../../platform/logger/logger.js';

const LOG_CTX = 'hyper_log_metrics';

/// The polling interval of the Hyper log in milliseconds, the resource usage of the embedded Hyper is logged every second
const DEFAULT_POLL_INTERVAL_MS = 1_000;
/// The number of finished queries that a session, or the client context of a connection, keeps. The oldest are dropped first
const MAX_QUERIES_PER_SESSION = 10_000;
/// The number of resource samples that are kept, an hour with a resource usage interval of 1s
const MAX_RESOURCE_SAMPLES = 3_600;

/// A query that a Hyper session finished, from its query-end event in the Hyper log.
export interface HyperQueryEnd {
    /// The Hyper session that ran the query
    sessionId: string;
    /// The end of the query in milliseconds since the epoch
    endedAt: number;
    /// Did the query succeed?
    succeeded: boolean;
    /// The SQLSTATE of a failed query
    errorCode: string | null;
    /// The error message of a failed query
    errorMessage: string | null;
    /// The statement type, e.g. SELECT
    statement: string | null;
    /// The query text, truncated by Hyper
    query: string | null;
    /// The shape of the query: the hash of its text with the literals normalized away, see queryShapeOf()
    queryShape: string | null;
    /// The elapsed time of the query in seconds
    elapsed: number | null;
    /// The thread time of the compilation and the execution in seconds
    threadTime: number;
    /// The CPU time of the threads of the compilation and the execution in seconds
    cpuTime: number;
    /// The time that the threads of the compilation and the execution waited in seconds
    waitTime: number;
    /// The time until a worker thread picked up the query in seconds
    timeToSchedule: number | null;
    /// The peak transaction memory of the compilation or the execution in MB
    peakMemoryMb: number | null;
    /// The result rows
    rows: number | null;
    /// The rows that the compilation and the execution processed
    processedRows: number;
    /// Did the app run the query and not the user, e.g. a computation (SQLFrame) on a pooled compute connection?
    system: boolean;
}

/// The client context of the queries of a connection that Hyper logs as ctx.client
interface DashQLClientContext {
    /// The fields of the app
    dashql: {
        /// The connection that the queries are attributed to
        connectionId: string;
        /// The kind of the queries
        queryType: 'sqlframe';
    };
}

/// The client context that attributes the queries of a computation to the connection of its table.
/// The queries run on pooled compute connections, whose sessions are shared by all connections.
export function sqlframeClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'sqlframe' } };
}

/// A sample of the resource usage of a Hyper process, from a resource-metrics event in the Hyper log.
/// Hyper writes one every log_resource_usage_interval.
export interface HyperResourceSample {
    /// The time of the sample in milliseconds since the epoch
    sampledAt: number;
    /// The physical memory of the process in MB, the size of the Wasm memory, which never shrinks
    processMemoryMb: number | null;
    /// The memory that the running queries hold in MB
    transactionMemoryMb: number | null;
    /// The memory of the storage layer in MB, e.g. the table data that is not flushed to the files yet
    storageMemoryMb: number | null;
    /// The overall load between 0 and 1
    overallLoad: number | null;
    /// The load of the scheduler between 0 and 1
    schedulerLoad: number | null;
    /// The memory load between 0 and 1
    memoryLoad: number | null;
}

/// The events of a poll of the Hyper log
export interface HyperLogEvents {
    /// The finished queries without a client context, ordered by their end
    queries: HyperQueryEnd[];
    /// The finished queries with a client context, by the connection it attributes them to, ordered by their end
    contextQueries: Map<string, HyperQueryEnd[]>;
    /// The resource samples, ordered by time
    samples: HyperResourceSample[];
}

/// The event key of resource samples
const RESOURCE_METRICS_EVENT = 'resource-metrics';

/// The query-end events without the internal queries, and the resource-metrics events.
/// The update query of the log source reads them.
const METRICS_SOURCE_QUERY = `
    SELECT * FROM log
    WHERE k = '${RESOURCE_METRICS_EVENT}'
        OR (k LIKE 'query-end%' AND coalesce(v::json->>'query-trunc', '') NOT LIKE '${HYPER_LOG_INTERNAL_QUERY_TAG}%')
`;

function logNumber(path: readonly string[]): string {
    return hyperLogValue(path, 'double precision');
}

/// The sum of a number of the compilation and the execution of a query-end event, 0 when missing
function phaseSum(path: readonly string[]): string {
    return `coalesce(${logNumber(['pre-execution', ...path])}, 0) + coalesce(${logNumber(['execution', ...path])}, 0)`;
}

/// The metrics of the query-end and resource-metrics events in the rows of a log source query.
/// The columns of the other event kind are NULL.
/// The log writes the wall-clock time of the host as timestamp without time zone, the query returns it as if it was UTC.
export function projectLogMetrics(sourceQuery: string): string {
    return `
        WITH events AS (${sourceQuery})
        SELECT
            (extract(epoch from ts) * 1000)::double precision AS wall_clock_ms,
            k AS kind,
            sess,
            k = 'query-end' AS succeeded,
            v::json->>'error-code' AS error_code,
            v::json->>'error-message' AS error_message,
            v::json->>'statement' AS statement,
            v::json->>'query-trunc' AS query,
            v::json->>'query-hash' AS query_hash,
            ${logNumber(['elapsed'])} AS elapsed,
            ${phaseSum(['threads', 'thread-time'])} AS thread_time,
            ${phaseSum(['threads', 'cpu-time'])} AS cpu_time,
            ${phaseSum(['threads', 'wait-time'])} AS wait_time,
            ${phaseSum(['processed-rows', 'total'])} AS processed_rows,
            ${logNumber(['time-to-schedule'])} AS time_to_schedule,
            greatest(
                ${logNumber(['pre-execution', 'peak-transaction-memory-mb'])},
                ${logNumber(['execution', 'peak-transaction-memory-mb'])}
            ) AS peak_memory_mb,
            ${logNumber(['rows'])} AS rows,
            ctx::json->'client'->'dashql'->>'connectionId' AS context_connection_id,
            ctx::json->'client'->'dashql'->>'queryType' AS context_query_type,
            ${logNumber(['memory', 'process_physical_memory_mb'])} AS process_memory_mb,
            ${logNumber(['mem-trackers', 'memory_tracked_current_usage_mb', 'global_transactions'])} AS transaction_memory_mb,
            ${logNumber(['mem-trackers', 'memory_tracked_current_usage_mb', 'storage_layer_unflushed_memory'])} AS storage_memory_mb,
            ${logNumber(['load', 'overall_load'])} AS overall_load,
            ${logNumber(['load', 'scheduler_load'])} AS scheduler_load,
            ${logNumber(['load', 'memory_load'])} AS memory_load
        FROM events
    `;
}

/// The shape of a query from its query-hash, e.g. `387e195b3a02` of `bfe4.387e195b3a02.24573b`.
/// The second part of the hash is the hash of the text with normalized literals, the third part hashes the literal
/// values, and the first part varies with the literals too. Queries that only differ in their literals or comments
/// share their shape.
export function queryShapeOf(queryHash: string | null): string | null {
    if (queryHash == null) return null;
    const parts = queryHash.split('.');
    return parts.length >= 3 ? parts[1] : queryHash;
}

/// Convert a wall-clock time that was read as UTC to milliseconds since the epoch, in the time zone of the host.
export function wallClockToEpochMs(wallClockMs: number): number {
    const d = new Date(wallClockMs);
    return new Date(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
    ).getTime();
}

function nullableNumber(value: unknown): number | null {
    return value == null ? null : Number(value);
}

function nullableString(value: unknown): string | null {
    return value == null ? null : String(value);
}

/// Read the events of a result of projectLogMetrics()
export function readLogMetrics(table: arrow.Table): HyperLogEvents {
    const queries: HyperQueryEnd[] = [];
    const contextQueries = new Map<string, HyperQueryEnd[]>();
    const samples: HyperResourceSample[] = [];
    for (const row of table) {
        const time = wallClockToEpochMs(Number(row.wall_clock_ms));
        if (row.kind === RESOURCE_METRICS_EVENT) {
            samples.push({
                sampledAt: time,
                processMemoryMb: nullableNumber(row.process_memory_mb),
                transactionMemoryMb: nullableNumber(row.transaction_memory_mb),
                storageMemoryMb: nullableNumber(row.storage_memory_mb),
                overallLoad: nullableNumber(row.overall_load),
                schedulerLoad: nullableNumber(row.scheduler_load),
                memoryLoad: nullableNumber(row.memory_load),
            });
            continue;
        }
        const query: HyperQueryEnd = {
            sessionId: String(row.sess),
            endedAt: time,
            succeeded: Boolean(row.succeeded),
            errorCode: nullableString(row.error_code),
            errorMessage: nullableString(row.error_message),
            statement: nullableString(row.statement),
            query: nullableString(row.query),
            queryShape: queryShapeOf(nullableString(row.query_hash)),
            elapsed: nullableNumber(row.elapsed),
            threadTime: Number(row.thread_time ?? 0),
            cpuTime: Number(row.cpu_time ?? 0),
            waitTime: Number(row.wait_time ?? 0),
            timeToSchedule: nullableNumber(row.time_to_schedule),
            peakMemoryMb: nullableNumber(row.peak_memory_mb),
            rows: nullableNumber(row.rows),
            processedRows: Number(row.processed_rows ?? 0),
            system: row.context_query_type === 'sqlframe',
        };
        const connectionId = nullableString(row.context_connection_id);
        if (connectionId == null) {
            queries.push(query);
        } else {
            const attributed = contextQueries.get(connectionId) ?? [];
            attributed.push(query);
            contextQueries.set(connectionId, attributed);
        }
    }
    for (const attributed of contextQueries.values()) attributed.sort((l, r) => l.endedAt - r.endedAt);
    return {
        queries: queries.sort((l, r) => l.endedAt - r.endedAt),
        contextQueries,
        samples: samples.sort((l, r) => l.sampledAt - r.sampledAt),
    };
}

/// A state of the log source that lives as long as the monitor connection.
function createMemoryState(): HyperDBExtractState {
    const values = new Map<string, string[]>();
    return {
        async values(key) { return values.get(key) ?? []; },
        async add(key, value) { values.set(key, [...(values.get(key) ?? []), value]); },
    };
}

/// The monitor of a Hyper whose log is read
interface HyperLogMonitor {
    /// The Hyper
    database: EmbeddedDatabase;
    /// Opens the monitor connection, resolves to null when the log cannot be read
    connection: Promise<EmbeddedConnection | null>;
    /// The log source with the cursor of the monitor connection
    source: HyperDBLogSource;
    /// The pending timer of the next poll
    timer: ReturnType<typeof setTimeout> | null;
    /// Set when the monitor is stopped
    stopped: boolean;
}

/// Options of the Hyper log metrics.
export interface HyperLogMetricsOptions {
    /// The logger
    logger: Logger;
    /// The polling interval in milliseconds
    pollIntervalMs?: number;
}

/// The finished queries of the tracked Hyper sessions and the resource samples of their Hyper process, read from the
/// Hyper log and kept in memory.
///
/// A monitor connection reads the query-end and resource-metrics events since its last poll with the log scope of a
/// HyperDBLogSource, every poll interval.
/// The queries of a connection are the queries of all sessions that were assigned to it, across reconnects, and the
/// queries of any session whose client context names the connection, e.g. the SQLFrame queries of computations on
/// pooled compute connections. The queries of other sessions are skipped.
/// The resource samples describe the whole process, which all tracked sessions share.
///
/// Limits:
/// - Events that are logged between the log scan of a poll and its scope reset are lost.
/// - The events are lost with a reload, and when the log cannot be read there are none.
/// - Resource samples are only read while a session is tracked, and only with log_resource_usage_interval set.
export class HyperLogMetrics {
    /// The monitor of the tracked Hyper, null before the first tracked session
    private monitor: HyperLogMonitor | null = null;
    /// The finished queries of every tracked session
    private readonly sessions = new Map<string, HyperQueryEnd[]>();
    /// The sessions of every connection
    private readonly connectionSessions = new Map<string, string[]>();
    /// The finished queries whose client context names a connection, by connection
    private readonly contextQueries = new Map<string, HyperQueryEnd[]>();
    /// The snapshots of the queries of the connections, stable until the queries change
    private readonly snapshots = new Map<string, HyperQueryEnd[]>();
    /// The resource samples of the tracked Hyper, replaced when samples are added
    private samples: HyperResourceSample[] = [];
    /// The subscribers
    private readonly listeners = new Set<() => void>();

    constructor(private readonly options: HyperLogMetricsOptions) {}

    /// Track the queries of a new connection to a Hyper, returns its session id, or null when its queries can't be
    /// tracked. The monitor starts reading the log of the Hyper before this returns, so that no query of the
    /// connection is missed.
    async track(database: EmbeddedDatabase, connection: EmbeddedConnection): Promise<string | null> {
        try {
            const sessionId = await readHyperSessionId(connection);
            if (this.monitor?.database !== database) this.startMonitor(database);
            if (await this.monitor!.connection == null) return null;
            if (!this.sessions.has(sessionId)) this.sessions.set(sessionId, []);
            return sessionId;
        } catch (error) {
            this.options.logger.warn('Tracking the queries of a Hyper connection failed', { error: stringifyError(error) }, LOG_CTX);
            return null;
        }
    }

    /// Assign a tracked session to a connection
    assign(connectionId: string, sessionId: string): void {
        const sessions = this.connectionSessions.get(connectionId) ?? [];
        if (sessions.includes(sessionId)) return;
        this.connectionSessions.set(connectionId, [...sessions, sessionId]);
        this.changed([connectionId]);
    }

    /// Forget the queries of all connections except the given ones, e.g. of deleted connections
    retain(connectionIds: ReadonlySet<string>): void {
        const known = new Set([...this.connectionSessions.keys(), ...this.contextQueries.keys()]);
        const forgotten = [...known].filter(id => !connectionIds.has(id));
        for (const connectionId of forgotten) {
            for (const sessionId of this.connectionSessions.get(connectionId) ?? []) {
                this.sessions.delete(sessionId);
            }
            this.connectionSessions.delete(connectionId);
            this.contextQueries.delete(connectionId);
        }
        if (forgotten.length > 0) this.changed(forgotten);
    }

    /// Subscribe to changes of the queries and the resource samples
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /// The finished queries of a connection, ordered by their end
    queries(connectionId: string): HyperQueryEnd[] {
        let snapshot = this.snapshots.get(connectionId);
        if (snapshot == null) {
            const parts = (this.connectionSessions.get(connectionId) ?? [])
                .map(sessionId => this.sessions.get(sessionId) ?? [])
                .concat([this.contextQueries.get(connectionId) ?? []])
                .filter(queries => queries.length > 0);
            snapshot = parts.length === 1 ? parts[0] : parts.flat().sort((l, r) => l.endedAt - r.endedAt);
            this.snapshots.set(connectionId, snapshot);
        }
        return snapshot;
    }

    /// The resource samples of the tracked Hyper, ordered by time
    resourceSamples(): HyperResourceSample[] {
        return this.samples;
    }

    /// Read the events that were logged since the last poll
    async poll(): Promise<void> {
        const monitor = this.monitor;
        const connection = await monitor?.connection;
        if (monitor == null || connection == null || monitor.stopped) return;
        const result = await connection.query(projectLogMetrics(monitor.source.updateQuery()));
        await monitor.source.advance(connection);
        const events = readLogMetrics(result);
        const newQueries = new Map<string, HyperQueryEnd[]>();
        for (const query of events.queries) {
            if (!this.sessions.has(query.sessionId)) continue;
            const queries = newQueries.get(query.sessionId) ?? [];
            queries.push(query);
            newQueries.set(query.sessionId, queries);
        }
        if (newQueries.size === 0 && events.contextQueries.size === 0 && events.samples.length === 0) return;
        if (events.samples.length > 0) {
            const all = this.samples.concat(events.samples);
            this.samples = all.slice(Math.max(all.length - MAX_RESOURCE_SAMPLES, 0));
        }
        for (const [sessionId, queries] of newQueries) {
            // Replace the queries of the session, the snapshots of the connections must not change
            const all = this.sessions.get(sessionId)!.concat(queries);
            this.sessions.set(sessionId, all.slice(Math.max(all.length - MAX_QUERIES_PER_SESSION, 0)));
        }
        for (const [connectionId, queries] of events.contextQueries) {
            const all = (this.contextQueries.get(connectionId) ?? []).concat(queries);
            this.contextQueries.set(connectionId, all.slice(Math.max(all.length - MAX_QUERIES_PER_SESSION, 0)));
        }
        const changedConnections = [...this.connectionSessions]
            .filter(([, sessions]) => sessions.some(sessionId => newQueries.has(sessionId)))
            .map(([connectionId]) => connectionId)
            .concat([...events.contextQueries.keys()]);
        this.changed(changedConnections);
    }

    /// Stop reading the log and close the monitor connection
    async stop(): Promise<void> {
        const monitor = this.monitor;
        this.monitor = null;
        if (monitor == null) return;
        monitor.stopped = true;
        if (monitor.timer != null) clearTimeout(monitor.timer);
        const connection = await monitor.connection;
        await connection?.close().catch(() => {});
    }

    private startMonitor(database: EmbeddedDatabase): void {
        void this.stop();
        const source = new HyperDBLogSource(METRICS_SOURCE_QUERY);
        const monitor: HyperLogMonitor = {
            database,
            source,
            connection: Promise.resolve(null),
            timer: null,
            stopped: false,
        };
        monitor.connection = (async () => {
            let connection: EmbeddedConnection | null = null;
            try {
                connection = await database.connect();
                await source.open(connection, createMemoryState());
                return connection;
            } catch (error) {
                this.options.logger.warn('Reading the Hyper log failed', { error: stringifyError(error) }, LOG_CTX);
                await connection?.close().catch(() => {});
                return null;
            }
        })();
        this.monitor = monitor;
        this.schedulePoll(monitor);
    }

    private schedulePoll(monitor: HyperLogMonitor): void {
        monitor.timer = setTimeout(() => {
            monitor.timer = null;
            void this.poll().then(
                () => { if (!monitor.stopped) this.schedulePoll(monitor); },
                error => {
                    // A Hyper that was terminated, e.g. by a hand-over to another tab, fails every poll.
                    // The next tracked connection starts a new monitor.
                    this.options.logger.warn('Polling the Hyper log failed', { error: stringifyError(error) }, LOG_CTX);
                    if (this.monitor === monitor) void this.stop();
                },
            );
        }, this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }

    private changed(connectionIds: string[]): void {
        for (const connectionId of connectionIds) {
            this.snapshots.delete(connectionId);
        }
        for (const listener of this.listeners) {
            listener();
        }
    }
}
