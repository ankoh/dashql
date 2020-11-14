// Copyright (c) 2020 The DashQL Authors

import duckdb_api_wasm from '../../wasm/duckdb_node.wasm';
import duckdb_api_init from '../../wasm/duckdb_node.js';
import { DuckDBModule } from '../../wasm/duckdb_module';
import * as webapi from '../../webapi';

export class DuckDB extends webapi.DuckDBBindings {
    protected path: string;
    constructor(path: string | null = null) {
        super();
        this.path = path ?? duckdb_api_wasm;
    }
    protected instantiate(moduleOverrides: Partial<DuckDBModule>): Promise<DuckDBModule> {
        return duckdb_api_init({
            ...moduleOverrides,
            locateFile: (path: string) => {
                if (path.endsWith('duckdb_node.wasm'))
                    return this.path;
                return path;
            }
        });
    }
}

export * from '../../webapi';
