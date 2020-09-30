// Copyright (c) 2020 The DashQL Authors

import { DuckDB as initDuckDB_ } from './duckdb/duckdb_webapi.js';
import DuckDBModule from './duckdb/duckdb_webapi.wasm';

async function initDuckDB(moduleOverrides: Partial<EmscriptenModule>): Promise<any> {
    return initDuckDB_({
        ...moduleOverrides,
        locateFile(path: string) {
            if (path.endsWith('.wasm'))
                return DuckDBModule;
            return path;
        }
    });
}

export class DuckDB {
    /// The instance
    private static instance: EmscriptenModule | null = null;
    /// The loading promise
    private static openPromise: Promise<void> | null = null;
    /// The resolver for the open promise (called by onRuntimeInitialized)
    private static openPromiseResolver: () => void = () => {};

    /// Open the database
    public static async open() {
        // Already opened?
        if (DuckDB.instance != null)
            return;
        // Open in progress?
        if (DuckDB.openPromise != null)
            await DuckDB.openPromise;

        // Create a promise that we can await
        DuckDB.openPromise = new Promise(resolve => {
            DuckDB.openPromiseResolver = resolve;
        });

        // Initialize duckdb
        await initDuckDB({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: DuckDB.openPromiseResolver,
        });

        // Wait for onRuntimeInitialized
        await DuckDB.openPromise;
    }
}
