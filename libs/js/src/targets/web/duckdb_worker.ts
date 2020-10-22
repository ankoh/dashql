// Copyright (c) 2020 The DashQL Authors

import { DuckDB as initDuckDB } from '../../duckdb/duckdb_webapi.js';

export function DuckDB(moduleOverrides: Partial<EmscriptenModule>): any {
    return initDuckDB({
        ...moduleOverrides,
        locateFile: (path: string) => {
            if (path.endsWith('duckdb_webapi.wasm')) {
                console.error("tried to locate webassembly module in worker");
                return path;
            }
            return path;
        }
    });
}
(window as any).DuckDB = DuckDB;

import '../../duckdb/duckdb_webapi.worker.js';
