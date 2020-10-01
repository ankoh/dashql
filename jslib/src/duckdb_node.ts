// Copyright (c) 2020 The DashQL Authors

import DuckDBModule from './duckdb/duckdb_nodeapi.wasm';
import { DuckDB as initDuckDB } from './duckdb/duckdb_nodeapi.js';
import { DuckDBProxy } from './jsproxy/duckdb_jsproxy';

export class DuckDB extends DuckDBProxy {
    protected init(moduleOverrides: Partial<EmscriptenModule>): Promise<EmscriptenModule> {
        return initDuckDB({
            ...moduleOverrides,
            locateFile(path: string) {
                if (path.endsWith('.wasm'))
                    return DuckDBModule;
                return path;
            }
        });
    }
}
