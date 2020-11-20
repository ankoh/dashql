// Copyright (c) 2020 The DashQL Authors

import duckdb_api_wasm from '../../wasm/duckdb_web.wasm';
import duckdb_api_init from '../../wasm/duckdb_web.js';
import { DuckDBModule } from '../../wasm/duckdb_module';
import * as webdb from '../../webdb';

export class DuckDB extends webdb.DuckDBBindings {
    protected path: string;
    constructor(path: string | null = null) {
        super();
        this.path = path ?? duckdb_api_wasm;
    }
    protected instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule> {
        return duckdb_api_init({
            ...moduleOverrides,
            locateFile: (path: string) => {
                if (path.endsWith('duckdb_webdb.wasm'))
                    return this.path;
                return path;
            }
        });
    }
}

export * from '../../webdb';
