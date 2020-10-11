// Copyright (c) 2020 The DashQL Authors

import duckdb_api_wasm from './duckdb/duckdb_webapi.wasm';
import duckdb_api_init from './duckdb/duckdb_webapi.js';
import { DuckDBModule } from './duckdb/duckdb_module';
import { DuckDBBindings } from './webapi/webapi_bindings';

export class DuckDB extends DuckDBBindings {
    protected instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule> {
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
