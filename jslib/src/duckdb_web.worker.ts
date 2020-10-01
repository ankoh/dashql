// Copyright (c) 2020 The DashQL Authors

import { DuckDB as initDuckDB } from './duckdb/duckdb_webapi.js';
import DuckDBPath from './duckdb/duckdb_webapi.wasm';

export function DuckDB(moduleOverrides: Partial<EmscriptenModule>): any {
    return initDuckDB({
        ...moduleOverrides,
        locateFile(path: string) {
            if (path.endsWith('.wasm'))
                return DuckDBPath;
            return path;
        }
    });
}
(window as any).DuckDB = DuckDB;

import './duckdb/duckdb_webapi.worker.js';
