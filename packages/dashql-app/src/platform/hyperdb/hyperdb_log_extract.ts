import {
    quoteLiteral,
    type HyperDBExtractColumn,
    type HyperDBExtractTable,
    type HyperDBIncrementalExtractSource,
    type HyperDBSourceConnection,
} from './hyperdb_incremental_extract.js';
import { quoteIdentifier } from './hyperdb_wasm.js';

/// The columns of hyper_log(), with ctx and v as JSON text.
export const HYPER_LOG_COLUMNS: readonly HyperDBExtractColumn[] = [
    { name: 'ts', type: 'TIMESTAMP' },
    { name: 'pid', type: 'BIGINT' },
    { name: 'tid', type: 'TEXT' },
    { name: 'sev', type: 'TEXT' },
    { name: 'req', type: 'TEXT' },
    { name: 'sess', type: 'TEXT' },
    { name: 'coordinating-req', type: 'TEXT' },
    { name: 'coordinating-sess', type: 'TEXT' },
    { name: 'ctx', type: 'TEXT' },
    { name: 'k', type: 'TEXT' },
    { name: 'v', type: 'TEXT' },
];

/// An extract table with the unchanged log events.
export const HYPER_LOG_EVENTS_TABLE: HyperDBExtractTable = {
    name: 'events',
    query: 'SELECT * FROM log',
};

/// A value at a JSON path of a JSON column of log events, v by default, cast to a type.
/// It is NULL when the path is missing, and for the gauges of resource-metrics events that the platform does not
/// record and logs as `{}`.
export function hyperLogValue(path: readonly string[], type: string, column = 'v'): string {
    const parents = path.slice(0, -1).map(key => `->${quoteLiteral(key)}`).join('');
    return `nullif(${column}::json${parents}->>${quoteLiteral(path[path.length - 1])}, '{}')::${type}`;
}

/// The sum of a number of the compilation and the execution of a query-end event, 0 when missing
function phaseSum(path: readonly string[]): string {
    const phase = (name: string) => `coalesce(${hyperLogValue([name, ...path], 'double precision')}, 0)`;
    return `${phase('pre-execution')} + ${phase('execution')}`;
}

/// A field of the client context of the queries, which Hyper logs as ctx.client, as a text column of the query ends
export interface HyperLogClientColumn {
    /// The name of the column
    name: string;
    /// The path of the field in the client context
    path: readonly string[];
}

/// An extract table with one row per finished query, with the metrics of its query-end event.
/// The outcome is the event key, e.g. query-end or query-end-user-error. The times are in seconds.
///
/// A query-hash like `bfe4.387e195b3a02.24573b` has three parts: the second hashes the text with normalized literals,
/// the third hashes the literal values, and the first varies with the literals too. Queries that only differ in their
/// literals or comments share the second part, the query_shape. Queries without a hash are shaped by their text.
export function hyperLogQueryEndsTable(clientColumns: readonly HyperLogClientColumn[] = []): HyperDBExtractTable {
    const hash = `v::json->>'query-hash'`;
    return {
        name: 'query_ends',
        query: `
            SELECT
                ts,
                sess,
                req,
                k AS outcome,
                k = 'query-end' AS succeeded,
                v::json->>'error-code' AS error_code,
                v::json->>'error-message' AS error_message,
                v::json->>'statement' AS statement,
                v::json->>'query-trunc' AS query,
                ${hash} AS query_hash,
                CASE WHEN ${hash} LIKE '%.%.%' THEN split_part(${hash}, '.', 2)
                    ELSE coalesce(${hash}, 'text:' || coalesce(v::json->>'query-trunc', '')) END AS query_shape,
                ${hyperLogValue(['elapsed'], 'double precision')} AS elapsed,
                ${phaseSum(['threads', 'thread-time'])} AS thread_time,
                ${phaseSum(['threads', 'cpu-time'])} AS cpu_time,
                ${phaseSum(['threads', 'wait-time'])} AS wait_time,
                (${phaseSum(['processed-rows', 'total'])})::bigint AS processed_rows,
                ${hyperLogValue(['time-to-schedule'], 'double precision')} AS time_to_schedule,
                greatest(
                    ${hyperLogValue(['pre-execution', 'peak-transaction-memory-mb'], 'double precision')},
                    ${hyperLogValue(['execution', 'peak-transaction-memory-mb'], 'double precision')}
                ) AS peak_memory_mb,
                ${hyperLogValue(['rows'], 'bigint')} AS rows${clientColumns.map(column => `,
                ${hyperLogValue(['client', ...column.path], 'text', 'ctx')} AS ${quoteIdentifier(column.name)}`).join('')}
            FROM log
            WHERE k LIKE 'query-end%'
        `,
    };
}

/// The query ends without client columns
export const HYPER_LOG_QUERY_ENDS_TABLE: HyperDBExtractTable = hyperLogQueryEndsTable();

/// An extract table with one row per resource-metrics event, which Hyper writes every log_resource_usage_interval.
/// The process memory is the size of the Wasm memory, which never shrinks. The transaction memory is the memory that
/// the running queries hold, the storage memory the table data that is not flushed to the files yet. The loads are
/// between 0 and 1.
export const HYPER_LOG_RESOURCE_METRICS_TABLE: HyperDBExtractTable = {
    name: 'resource_metrics',
    query: `
        SELECT
            ts,
            ${hyperLogValue(['memory', 'process_physical_memory_mb'], 'double precision')} AS process_memory_mb,
            ${hyperLogValue(['memory', 'total_physical_memory_mb'], 'double precision')} AS total_memory_mb,
            ${hyperLogValue(['mem-trackers', 'memory_tracked_current_usage_mb', 'global_transactions'], 'double precision')} AS transaction_memory_mb,
            ${hyperLogValue(['mem-trackers', 'memory_tracked_current_usage_mb', 'storage_layer_unflushed_memory'], 'double precision')} AS storage_memory_mb,
            ${hyperLogValue(['load', 'overall_load'], 'double precision')} AS overall_load,
            ${hyperLogValue(['load', 'scheduler_load'], 'double precision')} AS scheduler_load,
            ${hyperLogValue(['load', 'memory_load'], 'double precision')} AS memory_load,
            ${hyperLogValue(['scheduler-thread-count', 'scheduler_thread_count', 'active'], 'integer')} AS active_threads,
            ${hyperLogValue(['scheduler-thread-count', 'scheduler_waiting_jobs_count'], 'integer')} AS waiting_jobs
        FROM log
        WHERE k = 'resource-metrics'
    `,
};

/// The error of a Hyper that does not let the app read its log, e.g. without experimental_hyper_introspection_functions.
export class HyperLogUnreadableError extends Error {
    constructor(message: string) {
        super(`the Hyper log cannot be read: ${message}`);
        this.name = 'HyperLogUnreadableError';
    }
}

/// The time zones are offset from UTC by multiples of 15 minutes
const CLOCK_OFFSET_STEP_MS = 15 * 60_000;

/// The Hyper log as the source of an incremental extract, the relation `log` of its queries.
///
/// A scoped source reads the log scope of the session of its reader with every poll, the events since the session
/// started. The extract connects the next reader before every read, see HyperDBIncrementalExtract. Its backfills read
/// the retained log files from the watermark, e.g. after the cursor died with the connection.
///
/// Without sessions, e.g. over gRPC or HTTP where every query runs in a session of its own, the scope of a query only
/// holds its own events. A source that is not scoped backfills every poll from the watermark, reading the whole
/// retained log.
///
/// Limits:
/// - Log files that were rotated out, or written by an earlier Hyper process, cannot be backfilled.
/// - The source query only sees the events of one update or backfill, e.g. not the earlier events of a session.
export class HyperDBLogSource implements HyperDBIncrementalExtractSource {
    readonly relation = 'log';
    readonly columns = HYPER_LOG_COLUMNS;
    readonly watermarkColumn = 'ts';
    /// The query of the events in the scope of the reader, only for a scoped source
    readonly updateQuery?: () => string;

    constructor(
        /// A query over the relation `log` with the source events that selects the events to extract,
        /// e.g. `SELECT * FROM log WHERE sess <> '-' AND k LIKE 'query-%'`. It returns the columns of hyper_log().
        private readonly sourceQuery = 'SELECT * FROM log',
        /// Do the connections to the Hyper keep their sessions, so that a poll reads the scope of its reader?
        private readonly scoped = true,
    ) {
        if (scoped) this.updateQuery = () => this.query(true, null);
    }

    /// Check that the log can be read
    async open(connection: HyperDBSourceConnection): Promise<void> {
        try {
            await connection.query(`EXPLAIN (FORMAT SCHEMA) SELECT * FROM hyper_log(current_session := true, last_log_scope := ${this.scoped})`);
        } catch (error) {
            throw new HyperLogUnreadableError(error instanceof Error ? error.message : String(error));
        }
    }

    backfillQuery(since: string | null): string {
        return this.query(false, since);
    }

    /// Read the offset of the wall clock of the log from UTC in milliseconds, e.g. 7,200,000 for a Hyper in UTC+2.
    /// The log writes the wall-clock time of the Hyper host as timestamp without time zone.
    ///
    /// The offset is the logged end of a marker query read as UTC, minus its end on the clock of the app, rounded to
    /// 15 minutes. It tolerates a clock skew and a latency of a few minutes. A scoped source reads the marker from the
    /// scope of a new connection, otherwise it reads the whole retained log once.
    async readClockOffset(connection: HyperDBSourceConnection): Promise<number> {
        const marker = `dashql_clock_${crypto.randomUUID().replace(/-/g, '_')}`;
        await connection.query(`SELECT 1 AS ${marker}`);
        const endedAt = Date.now();
        const result = await connection.query(`
            SELECT (extract(epoch from max(ts)) * 1000)::double precision AS ended_at
            FROM hyper_log(current_session := ${this.scoped}, last_log_scope := ${this.scoped})
            WHERE k = 'query-end' AND v::json->>'query-trunc' LIKE ${quoteLiteral(`%${marker}%`)}
        `);
        const loggedAt = result.getChild('ended_at')?.get(0);
        if (loggedAt == null) throw new Error('the Hyper log does not hold the end of the clock query');
        return Math.round((Number(loggedAt) - endedAt) / CLOCK_OFFSET_STEP_MS) * CLOCK_OFFSET_STEP_MS;
    }

    /// The source query over the scoped or watermarked log
    private query(scoped: boolean, since: string | null): string {
        const columns = HYPER_LOG_COLUMNS.map(({ name, type }) => `${quoteIdentifier(name)}::${type} AS ${quoteIdentifier(name)}`).join(', ');
        return `
            WITH log AS (
                SELECT ${columns}
                FROM hyper_log(current_session := false, last_log_scope := ${scoped})
                ${since == null ? '' : `WHERE ${since}`}
            ),
            source_query AS (${this.sourceQuery})
            SELECT * FROM source_query
        `;
    }
}
