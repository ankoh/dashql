import { QueryScope } from './connection_metrics.js';

// The tables of the queries of a connection as SQL over the query ends of the extract of the Hyper log.
// The overview runs them with its client context, they are listed as queries of the app.

/// The rows that a table of queries lists
const MAX_ROWS = 100;

/// A number rounded to a number of decimals. A numeric without a scale has none in Hyper, it would round to integers.
const rounded = (value: string, decimals: number) => `round((${value})::numeric(38, 6), ${decimals})::double precision`;

/// Seconds of a column of the query ends as milliseconds, rounded to hundredths
const ms = (seconds: string) => rounded(`${seconds} * 1000`, 2);

/// The predicate of the query ends of a scope
function scopePredicate(scope: QueryScope): string {
    switch (scope) {
        case QueryScope.User: return 'NOT sent_by_app';
        case QueryScope.App: return 'sent_by_app';
        case QueryScope.All: return 'TRUE';
    }
}

/// The query ends of a scope that ended since a time, in milliseconds since the epoch.
/// The query ends are the rows of queryEndsQuery().
function selectQueryEnds(queryEnds: string, scope: QueryScope, since: number): string {
    return `SELECT * FROM (${queryEnds}) ends WHERE epoch_ms >= ${since} AND ${scopePredicate(scope)}`;
}

/// The finished queries, newest first.
export function recentQueriesSql(queryEnds: string, scope: QueryScope, since: number): string {
    return `
        SELECT
            local_ts::time AS time,
            CASE WHEN succeeded THEN 'ok' ELSE coalesce(error_code, 'failed') END AS status,
            coalesce(query, statement) AS query,
            ${ms('elapsed')} AS elapsed_ms,
            ${ms('cpu_time')} AS cpu_ms,
            ${ms('wait_time')} AS wait_ms,
            processed_rows,
            peak_memory_mb AS memory_mb,
            client_query_type AS source,
            error_message AS error
        FROM (${selectQueryEnds(queryEnds, scope, since)}) runs
        ORDER BY epoch_ms DESC
        LIMIT ${MAX_ROWS}`;
}

/// The shapes of queries with the text of their newest query, most elapsed time first.
/// Queries that only differ in their literals or comments share their shape, see hyperLogQueryEndsTable().
/// The shape column is the part of the query hash that they share, NULL for queries without a hash.
export function queryShapesSql(queryEnds: string, scope: QueryScope, since: number): string {
    return `
        WITH newest AS (
            SELECT *, epoch_ms = max(epoch_ms) OVER (PARTITION BY query_shape) AS is_newest
            FROM (${selectQueryEnds(queryEnds, scope, since)}) ends
        )
        SELECT
            max(CASE WHEN is_newest THEN coalesce(query, statement) END) AS query,
            count(*)::integer AS queries,
            (count(*) FILTER (WHERE NOT succeeded))::integer AS failed,
            ${ms('sum(elapsed)')} AS total_ms,
            ${rounded('100 * sum(elapsed) / nullif(sum(sum(elapsed)) OVER (), 0)', 1)} AS share_pct,
            ${ms('avg(elapsed)')} AS mean_ms,
            sum(processed_rows)::bigint AS processed_rows,
            max(peak_memory_mb) AS memory_mb,
            CASE WHEN query_shape LIKE 'text:%' THEN NULL ELSE query_shape END AS shape
        FROM newest
        GROUP BY query_shape
        ORDER BY total_ms DESC
        LIMIT ${MAX_ROWS}`;
}
