// Copyright (c) 2020 The DashQL Authors

import duckdb_api_wasm from './duckdb/duckdb_nodeapi.wasm';
import duckdb_api_init from './duckdb/duckdb_nodeapi.js';
import { DuckDBModule } from './duckdb/duckdb_module';
import { DuckDBProxy } from './jsproxy/duckdb_jsproxy';

export class DuckDB extends DuckDBProxy {
    protected init(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule> {
        return duckdb_api_init({
            ...moduleOverrides,
            locateFile(path: string) {
                if (path.endsWith('.wasm'))
                    return duckdb_api_wasm;
                return path;
            }
        });
    }
}
