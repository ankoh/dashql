import type { QueryExecutionResponseStream } from '../query_execution_state.js';
import type { QueryExecutionArgs } from '../query_execution_args.js';
import type { DuckDBConnectionDetails } from './duckdb_connection_state.js';

export async function executeDuckDBQuery(
    connection: DuckDBConnectionDetails,
    args: QueryExecutionArgs,
    abort?: AbortSignal,
): Promise<QueryExecutionResponseStream> {
    const channel = args.channelOverride?.type === 'duckdb' ? args.channelOverride.channel : connection.channel;
    if (!channel) throw new Error('DuckDB channel is not set up');
    return await channel.executeQuery(args.query, abort);
}
