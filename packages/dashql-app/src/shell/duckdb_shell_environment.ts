import { DuckDBConnection } from '../platform/duckdb/duckdb_api.js';
import { DashQLShellEnvironment } from './api.js';

export function createDuckDBShellEnvironment(connection: DuckDBConnection): DashQLShellEnvironment {
    return {
        executeQuery: query => connection.queryArrowIPC(query),
    };
}
