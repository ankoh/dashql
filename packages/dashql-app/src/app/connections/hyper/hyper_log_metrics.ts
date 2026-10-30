import type * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase, EmbeddedConnection } from '../../../platform/database/embedded_database.js';
import {
    HyperDBIncrementalExtract,
    HYPER_EXTRACT_ROW_COLUMN,
    quoteLiteral,
    type HyperDBExtractTable,
    type HyperDBExtractTransfer,
    type HyperDBSourceDatabase,
} from '../../../platform/hyperdb/hyperdb_incremental_extract.js';
import {
    HYPER_LOG_RESOURCE_METRICS_TABLE,
    HyperDBLogSource,
    HyperLogUnreadableError,
    hyperLogQueryEndsTable,
} from '../../../platform/hyperdb/hyperdb_log_extract.js';
import { quoteIdentifier } from '../../../platform/hyperdb/hyperdb_wasm.js';
import type { Logger } from '../../../platform/logger/logger.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { Store } from '../../../utils/store.js';

const LOG_CTX = 'hyper_log_metrics';

/// The polling interval of the Hyper log in milliseconds, the smallest bucket of the charts.
/// A poll reads all events since the last one, e.g. the resource usage that the embedded Hyper logs every second.
/// Every poll is about 15 queries of the monitor itself, which the extract of an embedded Hyper keeps too.
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/// The alias of the monitoring database of a connection on the connections of its monitor
const MONITORING_ALIAS = 'monitoring';
/// The time that the extract reaches back, twice the largest window of the connection metrics
const RETENTION_MS = 2 * 60 * 60_000;
/// The finished queries that the extract keeps at most, e.g. after a burst of queries. The oldest are deleted first.
/// The log monitor finishes about 3 queries per second itself, about 22,000 in the retention.
const MAX_QUERY_ENDS = 20_000;
/// The resource samples that the extract keeps at most, the retention with a resource usage interval of 1s
const MAX_RESOURCE_SAMPLES = 7_200;

/// A query that a Hyper session finished, from a row of the query ends of the extract.
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
    /// The kind of the query from its client context, see DashQLClientContext
    queryType: string | null;
    /// Did the app run the query and not the user? E.g. a computation (SQLFrame) on a pooled compute connection, or a
    /// read of the Hyper log.
    sentByApp: boolean;
}

/// The client context of the queries of a connection that Hyper logs as ctx.client
interface DashQLClientContext {
    /// The fields of the app
    dashql: {
        /// The connection that the queries are attributed to, none for the queries of the log monitor
        connectionId?: string;
        /// The kind of the queries: of the user on the sessions of the connection, of computations, of the
        /// connection overview, or of the log monitor
        queryType: 'user' | 'sqlframe' | 'overview' | 'monitor';
    };
}

/// The client context of the queries of the user on the sessions of a connection
export function connectionClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'user' } };
}

/// The client context that attributes the queries of a computation to the connection of its table.
/// The queries run on pooled compute connections, whose sessions are shared by all connections.
export function sqlframeClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'sqlframe' } };
}

/// The client context that attributes the queries of the overview of a connection to the connection
export function overviewClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'overview' } };
}

/// The client context of the connections of the log monitor of a connection, they read the Hyper log and write the
/// extract
function monitorClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'monitor' } };
}

/// A sample of the resource usage of a Hyper process, from a row of the resource metrics of the extract.
/// Hyper writes one every log_resource_usage_interval.
export interface HyperResourceSample {
    /// The time of the sample in milliseconds since the epoch
    sampledAt: number;
    /// The physical memory of the process in MB, the size of the Wasm memory, which never shrinks
    processMemoryMb: number | null;
    /// The memory that the running queries hold in MB
    transactionMemoryMb: number | null;
    /// The memory of all memory trackers in MB, e.g. table data, temporary tables, the running queries and caches
    trackedMemoryMb: number | null;
    /// The overall load between 0 and 1
    overallLoad: number | null;
    /// The load of the scheduler between 0 and 1
    schedulerLoad: number | null;
    /// The memory load between 0 and 1
    memoryLoad: number | null;
}

/// The query ends with the fields of the client context of the app
const QUERY_ENDS_TABLE: HyperDBExtractTable = {
    ...hyperLogQueryEndsTable([
        { name: 'client_connection_id', path: ['dashql', 'connectionId'] },
        { name: 'client_query_type', path: ['dashql', 'queryType'] },
    ]),
    maxRows: MAX_QUERY_ENDS,
    maxAgeMs: RETENTION_MS,
};

/// The resource samples of the Hyper process
const RESOURCE_METRICS_TABLE: HyperDBExtractTable = {
    ...HYPER_LOG_RESOURCE_METRICS_TABLE,
    maxRows: MAX_RESOURCE_SAMPLES,
    maxAgeMs: RETENTION_MS,
};

/// The events of the extract of a connection: the query-end events that its client context names, and the
/// resource-metrics events of the Hyper process
function metricsSourceQuery(connectionId: string): string {
    return `
        SELECT * FROM log
        WHERE k = 'resource-metrics'
            OR (k LIKE 'query-end%' AND ctx::json->'client'->'dashql'->>'connectionId' = ${quoteLiteral(connectionId)})
    `;
}

/// The rows of an extract table that a read selects
export interface ExtractRowRange {
    /// The rows after this row number, see HYPER_EXTRACT_ROW_COLUMN
    afterRow: number;
    /// The rows logged since this time in milliseconds since the epoch
    since: number;
}

/// The time of a log event in milliseconds since the epoch.
/// The log writes the wall-clock time of the Hyper host as timestamp without time zone, see HyperLogState.clockOffsetMs.
function epochMs(clockOffsetMs: number): string {
    return `(extract(epoch from ts) * 1000 - ${clockOffsetMs})::double precision`;
}

/// The time of a log event in the time zone of the app, as timestamp without time zone
function localTimestamp(clockOffsetMs: number): string {
    const shiftMs = -new Date().getTimezoneOffset() * 60_000 - clockOffsetMs;
    return shiftMs === 0 ? 'ts' : `ts + interval '${shiftMs / 1000} seconds'`;
}

/// The predicate of the rows of a range
function rangePredicate(clockOffsetMs: number, range: ExtractRowRange): string {
    return `${HYPER_EXTRACT_ROW_COLUMN} > ${range.afterRow} AND ${epochMs(clockOffsetMs)} >= ${range.since}`;
}

/// The finished queries in the query ends of the extract of a connection, with their sent_by_app, epoch_ms (the end in
/// milliseconds since the epoch) and local_ts (the end in the time zone of the app)
export function queryEndsQuery(queryEnds: string, clockOffsetMs: number, range?: ExtractRowRange): string {
    return `
        SELECT
            *,
            ${epochMs(clockOffsetMs)} AS epoch_ms,
            ${localTimestamp(clockOffsetMs)} AS local_ts,
            client_query_type IS DISTINCT FROM 'user' AS sent_by_app
        FROM ${queryEnds}
        ${range == null ? '' : `WHERE ${rangePredicate(clockOffsetMs, range)}`}
    `;
}

/// The resource samples in the resource metrics of the extract, with their epoch_ms
export function resourceSamplesQuery(resourceMetrics: string, clockOffsetMs: number, range: ExtractRowRange): string {
    return `SELECT *, ${epochMs(clockOffsetMs)} AS epoch_ms FROM ${resourceMetrics} WHERE ${rangePredicate(clockOffsetMs, range)}`;
}

function nullableNumber(value: unknown): number | null {
    return value == null ? null : Number(value);
}

function nullableString(value: unknown): string | null {
    return value == null ? null : String(value);
}

/// The highest row number of a result of extract rows, 0 without rows
export function lastExtractRow(table: arrow.Table): number {
    const rows = table.getChild(HYPER_EXTRACT_ROW_COLUMN);
    let last = 0;
    for (let i = 0; i < table.numRows; ++i) last = Math.max(last, Number(rows?.get(i) ?? 0));
    return last;
}

/// Read the finished queries of a result of queryEndsQuery(), ordered by their end.
/// The log times of Hyper in Wasm have millisecond resolution, the request number orders the queries of a session that
/// end within the same millisecond.
export function readQueryEnds(table: arrow.Table): HyperQueryEnd[] {
    const queries: { query: HyperQueryEnd, request: number }[] = [];
    for (const row of table) {
        queries.push({ request: Number(row.req ?? 0), query: {
            sessionId: String(row.sess),
            endedAt: Number(row.epoch_ms),
            succeeded: Boolean(row.succeeded),
            errorCode: nullableString(row.error_code),
            errorMessage: nullableString(row.error_message),
            statement: nullableString(row.statement),
            query: nullableString(row.query),
            elapsed: nullableNumber(row.elapsed),
            threadTime: Number(row.thread_time ?? 0),
            cpuTime: Number(row.cpu_time ?? 0),
            waitTime: Number(row.wait_time ?? 0),
            timeToSchedule: nullableNumber(row.time_to_schedule),
            peakMemoryMb: nullableNumber(row.peak_memory_mb),
            rows: nullableNumber(row.rows),
            processedRows: Number(row.processed_rows ?? 0),
            queryType: nullableString(row.client_query_type),
            sentByApp: Boolean(row.sent_by_app),
        } });
    }
    return queries
        .sort((l, r) => l.query.endedAt - r.query.endedAt || l.request - r.request)
        .map(({ query }) => query);
}

/// Read the resource samples of a result of resourceSamplesQuery(), ordered by time
export function readResourceSamples(table: arrow.Table): HyperResourceSample[] {
    const samples: HyperResourceSample[] = [];
    for (const row of table) {
        samples.push({
            sampledAt: Number(row.epoch_ms),
            processMemoryMb: nullableNumber(row.process_memory_mb),
            transactionMemoryMb: nullableNumber(row.transaction_memory_mb),
            trackedMemoryMb: nullableNumber(row.tracked_memory_mb),
            overallLoad: nullableNumber(row.overall_load),
            schedulerLoad: nullableNumber(row.scheduler_load),
            memoryLoad: nullableNumber(row.memory_load),
        });
    }
    return samples.sort((l, r) => l.sampledAt - r.sampledAt);
}

/// The status of the monitor of the Hyper log of a connection
export enum HyperLogStatus {
    /// The log of the connection is not monitored, e.g. before the setup of the connection
    Closed = 'closed',
    /// The monitor opens the extract
    Opening = 'opening',
    /// The extract is open and polled
    Open = 'open',
    /// The log cannot be read, or a poll failed, see HyperLogState.error
    Unavailable = 'unavailable',
}

/// Why the Hyper log of a connection cannot be read
export interface HyperLogError {
    /// Does the Hyper refuse to read its log, e.g. without experimental_hyper_introspection_functions?
    /// Otherwise reading or extracting the log failed, e.g. after the Hyper was terminated.
    unreadable: boolean;
    /// The message of the error
    message: string;
}

/// The state of the extract of the Hyper log of a connection
export interface HyperLogState {
    /// The status of the monitor
    status: HyperLogStatus;
    /// Why the log cannot be read, set when the monitor is unavailable
    error: HyperLogError | null;
    /// The qualified table of the finished queries on the reader, see queryEndsQuery(), null until the extract is open
    queryEnds: string | null;
    /// The qualified table of the resource samples on the reader, see resourceSamplesQuery()
    resourceMetrics: string | null;
    /// The offset of the wall clock of the log from UTC in milliseconds, e.g. 7,200,000 for a Hyper in UTC+2.
    /// The log writes the wall-clock time of the Hyper host, which is not the time zone of the app for a remote Hyper.
    clockOffsetMs: number | null;
    /// The transfers that appended rows to the extract, it changes with every new row
    transfers: number;
    /// Does the Hyper log its resource usage? Null until a poll after the open tells, false while no transfer found a
    /// resource sample, e.g. without log_resource_usage_interval.
    resourceUsageLogged: boolean | null;
}

/// The state of a connection without an open extract
export const CLOSED_LOG_STATE: HyperLogState = {
    status: HyperLogStatus.Closed,
    error: null,
    queryEnds: null,
    resourceMetrics: null,
    clockOffsetMs: null,
    transfers: 0,
    resourceUsageLogged: null,
};

/// The open extract of a connection and its reader
interface OpenHyperLog {
    /// The extract
    extract: HyperDBIncrementalExtract;
    /// The connection that reads the extract for the overview, with the monitoring database attached
    reader: EmbeddedConnection;
}

/// The Hyper whose log is monitored
export interface HyperLogOrigin {
    /// The Hyper, e.g. the embedded Hyper or a channel to a remote Hyper
    database: HyperDBSourceDatabase;
    /// Do the connections to the Hyper keep their sessions? A poll then reads the log scope of its session, otherwise
    /// the whole retained log, see HyperDBLogSource.
    sessions: boolean;
}

/// The monitor of the log of a connection
interface HyperLogMonitor {
    /// The Hyper whose log is read
    origin: HyperLogOrigin;
    /// Opens the extract and its reader, resolves to null when the log cannot be read
    log: Promise<OpenHyperLog | null>;
    /// The last read of the reader, the reads run one after another
    reading: Promise<unknown>;
}

/// Options of the Hyper log metrics.
export interface HyperLogMetricsOptions {
    /// The logger
    logger: Logger;
    /// The polling interval in milliseconds
    pollIntervalMs?: number;
    /// Prepare the monitoring database of a connection, e.g. create the folder of the connection, and return its path
    prepareDatabase: (connectionId: string) => Promise<string>;
    /// The embedded Hyper that holds the monitoring databases, its compute database stages the transfers
    sink: () => Promise<EmbeddedComputeDatabase>;
}

/// The finished queries of the connections to a Hyper and the resource samples of the Hyper, extracted from its log
/// into the monitoring database of every connection, every poll interval.
///
/// The extract of a connection holds the queries whose client context names the connection, see DashQLClientContext:
/// the queries of the user and the app, and the reads and writes of its own log monitor. Its reader reads the
/// extract with the client context of the overview. The resource samples describe the whole Hyper process, which the
/// connections to the same Hyper share.
///
/// The monitoring databases live in the embedded Hyper, also for a remote Hyper.
///
/// Limits:
/// - The connections to the same Hyper monitor its log one by one, each reads the resource samples again.
/// - A Hyper without sessions, e.g. over gRPC or HTTP, is read from the watermark with every poll, which reads its whole
///   retained log.
/// - The log files of earlier Hyper processes cannot be backfilled, the extract misses the queries while no app
///   window monitored the connection.
/// - Resource samples are only logged with log_resource_usage_interval set.
/// - A Hyper that does not let the app read its log, e.g. without experimental_hyper_introspection_functions, leaves the
///   monitor unavailable. The connection itself works as before, the monitor does not retry.
export class HyperLogMetrics {
    /// The states of the extracts by connection
    readonly state = new Store<ReadonlyMap<string, HyperLogState>>(new Map());
    /// The monitors by connection
    private readonly monitors = new Map<string, HyperLogMonitor>();

    constructor(private readonly options: HyperLogMetricsOptions) {}

    /// Extract the log of the Hyper of a connection, e.g. of the embedded Hyper. Another Hyper replaces the watched
    /// one, e.g. after the hand-over of the app to another tab. The backfill of the extract reads the retained log.
    watch(origin: HyperLogOrigin, connectionId: string): void {
        if (this.monitors.get(connectionId)?.origin.database === origin.database) return;
        void this.forget(connectionId);
        const monitor: HyperLogMonitor = { origin, log: Promise.resolve(null), reading: Promise.resolve() };
        this.monitors.set(connectionId, monitor);
        this.updateState(connectionId, { ...CLOSED_LOG_STATE, status: HyperLogStatus.Opening });
        monitor.log = this.open(connectionId, monitor);
    }

    /// Wait until the extract of a connection is open, false when it cannot be read
    async opened(connectionId: string): Promise<boolean> {
        const monitor = this.monitors.get(connectionId);
        return monitor != null && (await monitor.log) != null;
    }

    /// Read the extract of a connection on its reader, e.g. with queryEndsQuery(). The reads run one after another.
    async query(connectionId: string, sql: string): Promise<arrow.Table> {
        const monitor = this.monitors.get(connectionId);
        if (monitor == null) throw new Error(`the Hyper log of the connection ${connectionId} is not monitored`);
        const read = monitor.reading.catch(() => {}).then(async () => {
            const log = await monitor.log;
            if (log == null) throw new Error(`the Hyper log extract of the connection ${connectionId} cannot be read`);
            return await log.reader.query(sql);
        });
        monitor.reading = read;
        return await read;
    }

    /// Transfer the events that were logged since the last poll, e.g. in tests that do not wait for the interval
    async poll(connectionId: string): Promise<void> {
        const log = await this.monitors.get(connectionId)?.log;
        if (log == null) return;
        this.transferred(connectionId, await log.extract.poll());
    }

    /// Stop the monitors of all connections except the given ones, e.g. of deleted connections.
    /// A stopped monitor closes the monitoring database of its connection.
    retain(connectionIds: ReadonlySet<string>): void {
        for (const connectionId of [...this.monitors.keys()]) {
            if (!connectionIds.has(connectionId)) void this.forget(connectionId);
        }
        // The unavailable monitors were stopped already, but kept their state
        for (const connectionId of [...this.state.current.keys()]) {
            if (!connectionIds.has(connectionId)) this.updateState(connectionId, null);
        }
    }

    /// Stop the monitor of a connection and close its monitoring database
    async forget(connectionId: string): Promise<void> {
        const monitor = this.monitors.get(connectionId);
        if (monitor == null) return;
        this.monitors.delete(connectionId);
        this.updateState(connectionId, null);
        await monitor.reading.catch(() => {});
        const log = await monitor.log;
        await log?.reader.close().catch(() => {});
        await log?.extract.stop().catch(() => {});
    }

    /// Stop the monitors of all connections
    async stop(): Promise<void> {
        await Promise.all([...this.monitors.keys()].map(connectionId => this.forget(connectionId)));
    }

    /// Open the extract of a connection and its reader, and start polling.
    /// A failure leaves the connection unavailable with the error, e.g. for a Hyper that does not let the app read its log.
    private async open(connectionId: string, monitor: HyperLogMonitor): Promise<OpenHyperLog | null> {
        const { origin } = monitor;
        const source = new HyperDBLogSource(metricsSourceQuery(connectionId), origin.sessions);
        let extract: HyperDBIncrementalExtract | null = null;
        let reader: EmbeddedConnection | null = null;
        let clockOffsetMs: number;
        try {
            const path = await this.options.prepareDatabase(connectionId);
            const sink = await this.options.sink();
            extract = await HyperDBIncrementalExtract.open({
                sourceDatabase: origin.database,
                source,
                sink,
                databasePath: path,
                databaseAlias: MONITORING_ALIAS,
                tables: [QUERY_ENDS_TABLE, RESOURCE_METRICS_TABLE],
                clientContext: monitorClientContext(connectionId),
                intervalMs: this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
                onTransfer: transfer => this.transferred(connectionId, transfer),
                onRebuild: reason => this.options.logger.info('Rebuilding the extract of the Hyper log', { connectionId, reason }, LOG_CTX),
                onError: error => {
                    // A Hyper that was terminated, e.g. by a hand-over to another tab, fails every poll.
                    // Setting up the connection again starts a new monitor.
                    this.options.logger.warn('Polling the Hyper log failed', { error: stringifyError(error) }, LOG_CTX);
                    if (this.monitors.get(connectionId) === monitor) this.fail(connectionId, error);
                },
            });
            const clock = await origin.database.connect({ clientContext: monitorClientContext(connectionId) });
            try {
                clockOffsetMs = await source.readClockOffset(clock);
            } finally {
                await clock.close().catch(() => {});
            }
            reader = await sink.connect({ clientContext: overviewClientContext(connectionId) });
            await reader.execute(`ATTACH DATABASE ${quoteIdentifier(path)} AS ${quoteIdentifier(MONITORING_ALIAS)}`);
        } catch (error) {
            await reader?.close().catch(() => {});
            await extract?.stop().catch(() => {});
            if (error instanceof HyperLogUnreadableError) {
                this.options.logger.info('The Hyper does not let the app read its log', { error: stringifyError(error) }, LOG_CTX);
            } else {
                this.options.logger.warn('Opening the Hyper log extract failed', { error: stringifyError(error) }, LOG_CTX);
            }
            if (this.monitors.get(connectionId) === monitor) this.fail(connectionId, error);
            return null;
        }
        if (this.monitors.get(connectionId) !== monitor) {
            await reader.close().catch(() => {});
            await extract.stop().catch(() => {});
            return null;
        }
        this.updateState(connectionId, {
            status: HyperLogStatus.Open,
            error: null,
            queryEnds: extract.tableName(QUERY_ENDS_TABLE.name),
            resourceMetrics: extract.tableName(RESOURCE_METRICS_TABLE.name),
            clockOffsetMs,
            transfers: 1,
            // The backfill read the retained log, a Hyper that just started may not have logged a sample yet
            resourceUsageLogged: (extract.backfill.tables[RESOURCE_METRICS_TABLE.name] ?? 0) > 0 ? true : null,
        });
        extract.start();
        return { extract, reader };
    }

    /// Stop the monitor of a connection after an error, its state keeps the error until the connection is watched again
    private fail(connectionId: string, error: unknown): void {
        void this.forget(connectionId);
        this.updateState(connectionId, {
            ...CLOSED_LOG_STATE,
            status: HyperLogStatus.Unavailable,
            error: {
                unreadable: error instanceof HyperLogUnreadableError,
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }

    private transferred(connectionId: string, transfer: HyperDBExtractTransfer): void {
        const state = this.state.current.get(connectionId);
        if (state == null || state.status !== HyperLogStatus.Open) return;
        // A Hyper that logs its resource usage logs a sample every interval, a poll without one marks it as not logged
        const resourceUsageLogged = state.resourceUsageLogged === true || (transfer.tables[RESOURCE_METRICS_TABLE.name] ?? 0) > 0;
        if (transfer.appended === 0 && resourceUsageLogged === state.resourceUsageLogged) return;
        this.updateState(connectionId, {
            ...state,
            transfers: state.transfers + (transfer.appended === 0 ? 0 : 1),
            resourceUsageLogged,
        });
    }

    /// Replace the state of a connection, null removes it
    private updateState(connectionId: string, state: HyperLogState | null): void {
        this.state.update(states => {
            const next = new Map(states);
            if (state == null) next.delete(connectionId);
            else next.set(connectionId, state);
            return next;
        });
    }
}
