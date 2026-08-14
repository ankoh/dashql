import { DuckDBConnection } from '../shared/platform/duckdb/duckdb_api.js';
import { DashQLShellEnvironment } from './api.js';

export function createDuckDBShellEnvironment(connection: DuckDBConnection): DashQLShellEnvironment {
    return {
        executeQuery: async (query, signal) => {
            signal?.throwIfAborted();
            const queryResult = await connection.queryArrowIPC(query);
            signal?.throwIfAborted();
            return queryResult;
        },
    };
}
