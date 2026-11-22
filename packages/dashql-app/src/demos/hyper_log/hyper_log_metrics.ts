import type * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase, EmbeddedConnection } from '@akohn/dashql/platform/embedded_database';
import {
    HyperDBIncrementalExtract,
    HYPER_EXTRACT_ROW_COLUMN,
    type HyperDBExtractTable,
    type HyperDBExtractTransfer,
    type HyperDBSourceDatabase,
} from '../shared/hyperdb_incremental_extract.js';
import {
    HYPER_LOG_RESOURCE_METRICS_TABLE,
    HyperDBLogSource,
    HyperLogUnreadableError,
    hyperLogQueryEndsTable,
    isHyperLogFlushTimeout,
} from './hyperdb_log_extract.js';
import type { EmbeddedClientContext } from '@akohn/dashql/platform/embedded_database';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { Store } from '../../utils/store.js';
import { quoteIdentifier, quoteLiteral } from '@akohn/dashql/platform/utils/sql_quote';

const LOG_CTX = 'hyper_log_metrics';

/// The polling interval of the Hyper log in milliseconds, the smallest bucket of the charts.
/// A poll reads all events since the last one, e.g. the resource usage that the embedded Hyper logs every second.
/// Every poll is about 15 queries of the monitor itself, which the extract of an embedded Hyper keeps too.
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/// The alias of the monitoring database on the connections of the monitor
const MONITORING_ALIAS = 'monitoring';
/// The attempts to open an extract while reading the log times out, e.g. on a Hyper under load, and the pause between them
const OPEN_ATTEMPTS = 5;
const OPEN_RETRY_MS = 1_000;
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
    /// The kind of the query from its client context, see HyperLogQueryType
    queryType: string | null;
    /// Did the app run the query and not the user? E.g. a computation (SQLFrame) on a pooled compute connection, or a
    /// read of the Hyper log.
    sentByApp: boolean;
}

/// The kind of a query in its client context: of the user on the sessions of a connection, of a computation on a pooled
/// connection (`sqlframe`, like the core attributes them), of the reader of the dashboard (`overview`) or of the monitor
/// that reads the Hyper log and writes the extract (`monitor`)
export type HyperLogQueryType = 'user' | 'sqlframe' | 'overview' | 'monitor';

/// The client context that attributes a query to a connection, which Hyper logs as ctx.client
export function hyperLogClientContext(connectionId: string, queryType: HyperLogQueryType): EmbeddedClientContext {
    return { dashql: { connectionId, queryType } };
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

/// The events of the extract: the query-end events whose client context names the connection, and the resource-metrics
/// events of the Hyper process
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
/// The embedded Hyper logs the wall-clock time of the page as timestamp without time zone, in the time zone of the app.
function epochMs(): string {
    return `(extract(epoch from ts) * 1000 + ${new Date().getTimezoneOffset() * 60_000})::double precision`;
}

/// The predicate of the rows of a range
function rangePredicate(range: ExtractRowRange): string {
    return `${HYPER_EXTRACT_ROW_COLUMN} > ${range.afterRow} AND ${epochMs()} >= ${range.since}`;
}

/// The finished queries in the query ends of the extract, with their sent_by_app, epoch_ms (the end in milliseconds
/// since the epoch) and local_ts (the end in the time zone of the app)
export function queryEndsQuery(queryEnds: string, range?: ExtractRowRange): string {
    return `
        SELECT
            *,
            ${epochMs()} AS epoch_ms,
            ts AS local_ts,
            client_query_type IS DISTINCT FROM 'user' AS sent_by_app
        FROM ${queryEnds}
        ${range == null ? '' : `WHERE ${rangePredicate(range)}`}
    `;
}

/// The resource samples in the resource metrics of the extract, with their epoch_ms
export function resourceSamplesQuery(resourceMetrics: string, range: ExtractRowRange): string {
    return `SELECT *, ${epochMs()} AS epoch_ms FROM ${resourceMetrics} WHERE ${rangePredicate(range)}`;
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

/// The status of the monitor of the Hyper log
export enum HyperLogStatus {
    /// The monitor opens the extract
    Opening = 'opening',
    /// The extract is open and polled
    Open = 'open',
    /// The log cannot be read, or a poll failed, see HyperLogState.error
    Unavailable = 'unavailable',
}

/// Why the Hyper log cannot be read
export interface HyperLogError {
    /// Does the Hyper refuse to read its log, e.g. without experimental_hyper_introspection_functions?
    /// Otherwise reading or extracting the log failed, e.g. after the Hyper was terminated.
    unreadable: boolean;
    /// The message of the error
    message: string;
}

/// The state of the extract of the Hyper log
export interface HyperLogState {
    /// The status of the monitor
    status: HyperLogStatus;
    /// Why the log cannot be read, set when the monitor is unavailable
    error: HyperLogError | null;
    /// The qualified table of the finished queries on the reader, see queryEndsQuery(), null until the extract is open
    queryEnds: string | null;
    /// The qualified table of the resource samples on the reader, see resourceSamplesQuery()
    resourceMetrics: string | null;
    /// The transfers that appended rows to the extract, it changes with every new row
    transfers: number;
    /// Does the Hyper log its resource usage? Null until a poll after the open tells, false while no transfer found a
    /// resource sample, e.g. without log_resource_usage_interval.
    resourceUsageLogged: boolean | null;
}

/// The open extract and its reader
interface OpenHyperLog {
    /// The extract
    extract: HyperDBIncrementalExtract;
    /// The connection that reads the extract for the dashboard, with the monitoring database attached
    reader: EmbeddedConnection;
}

/// Options of the Hyper log metrics.
export interface HyperLogMetricsOptions {
    /// The logger
    logger: Logger;
    /// The connection whose queries the extract holds, by their client context, see hyperLogClientContext()
    connectionId: string;
    /// The Hyper whose log is read, its connections keep their sessions
    source: HyperDBSourceDatabase;
    /// The embedded Hyper that holds the monitoring database, its compute database stages the transfers
    sink: EmbeddedComputeDatabase;
    /// Prepare the monitoring database, e.g. create its folder, and return its path
    prepareDatabase: () => Promise<string>;
    /// The polling interval in milliseconds
    pollIntervalMs?: number;
    /// The pause between the attempts to open the extract while reading the log times out, in milliseconds
    openRetryMs?: number;
}

/// The finished queries of a connection to the embedded Hyper and the resource samples of the Hyper, extracted from its
/// log into a monitoring database every poll interval. The monitor opens the extract when it is created.
///
/// The extract holds the queries whose client context names the connection: the queries of the user and the app, and
/// the reads and writes of the monitor itself. Its reader reads the extract with the client context of the overview.
///
/// Limits:
/// - The log files of earlier Hyper processes cannot be backfilled.
/// - Resource samples are only logged with log_resource_usage_interval set.
/// - A Hyper that does not let the app read its log, e.g. without experimental_hyper_introspection_functions, leaves the
///   monitor unavailable. The monitor does not retry.
/// - A read of the log that times out on a Hyper under load is retried, see isHyperLogFlushTimeout(). The extract then
///   falls behind until the reads succeed again, also without a notice in the state.
export class HyperLogMetrics {
    /// The state of the extract
    readonly state = new Store<HyperLogState>({
        status: HyperLogStatus.Opening,
        error: null,
        queryEnds: null,
        resourceMetrics: null,
        transfers: 0,
        resourceUsageLogged: null,
    });
    /// Opens the extract and its reader, resolves to null when the log cannot be read or the monitor stopped
    private readonly log: Promise<OpenHyperLog | null>;
    /// The last read of the reader, the reads run one after another
    private reading: Promise<unknown> = Promise.resolve();
    /// Was the monitor stopped, e.g. after an error?
    private stopped = false;

    constructor(private readonly options: HyperLogMetricsOptions) {
        this.log = this.open();
    }

    /// The connection whose queries the extract holds
    get connectionId(): string {
        return this.options.connectionId;
    }

    /// Wait until the extract is open, false when it cannot be read
    async opened(): Promise<boolean> {
        return (await this.log) != null;
    }

    /// Read the extract on its reader, e.g. with queryEndsQuery(). The reads run one after another.
    async query(sql: string): Promise<arrow.Table> {
        if (this.stopped) throw new Error('the monitor of the Hyper log is stopped');
        const read = this.reading.catch(() => {}).then(async () => {
            const log = await this.log;
            if (log == null) throw new Error('the Hyper log extract cannot be read');
            return await log.reader.query(sql);
        });
        this.reading = read;
        return await read;
    }

    /// Transfer the events that were logged since the last poll, e.g. in tests that do not wait for the interval
    async poll(): Promise<void> {
        const log = await this.log;
        if (log == null || this.stopped) return;
        try {
            this.transferred(await log.extract.poll());
        } catch (error) {
            // The next poll reads the same events
            if (!isHyperLogFlushTimeout(error)) throw error;
            this.options.logger.warn('Polling the Hyper log timed out', { error: stringifyError(error) }, LOG_CTX);
        }
    }

    /// Stop the monitor and close the monitoring database
    async stop(): Promise<void> {
        this.stopped = true;
        await this.reading.catch(() => {});
        const log = await this.log;
        await log?.reader.close().catch(() => {});
        await log?.extract.stop().catch(() => {});
    }

    /// Open the extract and its reader, and start polling.
    /// A failure leaves the monitor unavailable with the error, e.g. for a Hyper that does not let the app read its log.
    /// A read of the log that times out is tried again first.
    private async open(): Promise<OpenHyperLog | null> {
        for (let attempt = 1; ; ++attempt) {
            try {
                return await this.openOnce();
            } catch (error) {
                if (attempt < OPEN_ATTEMPTS && isHyperLogFlushTimeout(error)) {
                    this.options.logger.info('Opening the Hyper log extract timed out', { attempt: String(attempt) }, LOG_CTX);
                    await new Promise(resolve => setTimeout(resolve, this.options.openRetryMs ?? OPEN_RETRY_MS));
                    if (this.stopped) return null;
                    continue;
                }
                if (error instanceof HyperLogUnreadableError) {
                    this.options.logger.info('The Hyper does not let the app read its log', { error: stringifyError(error) }, LOG_CTX);
                } else {
                    this.options.logger.warn('Opening the Hyper log extract failed', { error: stringifyError(error) }, LOG_CTX);
                }
                this.fail(error);
                return null;
            }
        }
    }

    /// Open the extract and its reader, and start polling. A failure closes them again and throws.
    private async openOnce(): Promise<OpenHyperLog | null> {
        const { connectionId, logger, sink } = this.options;
        let extract: HyperDBIncrementalExtract | null = null;
        let reader: EmbeddedConnection | null = null;
        // The steps of the open, in the debug log
        let stepStart = performance.now();
        const step = (name: string) => {
            const now = performance.now();
            logger.debug('Opening the Hyper log extract', { step: name, durationMs: (now - stepStart).toFixed(1) }, LOG_CTX);
            stepStart = now;
        };
        const path = await this.options.prepareDatabase();
        step('prepared the monitoring database');
        try {
            extract = await HyperDBIncrementalExtract.open({
                sourceDatabase: this.options.source,
                source: new HyperDBLogSource(metricsSourceQuery(connectionId)),
                sink,
                databasePath: path,
                databaseAlias: MONITORING_ALIAS,
                tables: [QUERY_ENDS_TABLE, RESOURCE_METRICS_TABLE],
                clientContext: hyperLogClientContext(connectionId, 'monitor'),
                intervalMs: this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
                onTransfer: transfer => this.transferred(transfer),
                onRebuild: reason => logger.info('Rebuilding the extract of the Hyper log', { reason }, LOG_CTX),
                logger,
                onError: error => {
                    // A Hyper that was terminated fails every poll
                    logger.warn('Polling the Hyper log failed', { error: stringifyError(error) }, LOG_CTX);
                    // The next poll reads the events of a read that timed out
                    if (!isHyperLogFlushTimeout(error)) this.fail(error);
                },
            });
            step('opened the extract');
            reader = await sink.connect({ clientContext: hyperLogClientContext(connectionId, 'overview') });
            await reader.execute(`ATTACH DATABASE ${quoteIdentifier(path)} AS ${quoteIdentifier(MONITORING_ALIAS)}`);
            step('attached the reader');
        } catch (error) {
            await reader?.close().catch(() => {});
            await extract?.stop().catch(() => {});
            throw error;
        }
        if (this.stopped) {
            await reader.close().catch(() => {});
            await extract.stop().catch(() => {});
            return null;
        }
        this.state.update({
            status: HyperLogStatus.Open,
            error: null,
            queryEnds: extract.tableName(QUERY_ENDS_TABLE.name),
            resourceMetrics: extract.tableName(RESOURCE_METRICS_TABLE.name),
            transfers: 1,
            // The backfill read the retained log, a Hyper that just started may not have logged a sample yet
            resourceUsageLogged: (extract.backfill.tables[RESOURCE_METRICS_TABLE.name] ?? 0) > 0 ? true : null,
        });
        extract.start();
        return { extract, reader };
    }

    /// Stop the monitor after an error, its state keeps the error
    private fail(error: unknown): void {
        if (this.stopped) return;
        void this.stop();
        this.state.update({
            status: HyperLogStatus.Unavailable,
            error: {
                unreadable: error instanceof HyperLogUnreadableError,
                message: error instanceof Error ? error.message : String(error),
            },
            queryEnds: null,
            resourceMetrics: null,
            transfers: 0,
            resourceUsageLogged: null,
        });
    }

    private transferred(transfer: HyperDBExtractTransfer): void {
        const state = this.state.current;
        if (state.status !== HyperLogStatus.Open) return;
        // A Hyper that logs its resource usage logs a sample every interval, a poll without one marks it as not logged
        const resourceUsageLogged = state.resourceUsageLogged === true || (transfer.tables[RESOURCE_METRICS_TABLE.name] ?? 0) > 0;
        if (transfer.appended === 0 && resourceUsageLogged === state.resourceUsageLogged) return;
        this.state.update({
            ...state,
            transfers: state.transfers + (transfer.appended === 0 ? 0 : 1),
            resourceUsageLogged,
        });
    }
}
