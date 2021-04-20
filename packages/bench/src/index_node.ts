import * as duckdb_serial from '@dashql/duckdb/src/targets/duckdb-node-serial';
import * as duckdb_parallel from '@dashql/duckdb/src/targets/duckdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';

import { benchmarkFormat } from './format_benchmark';
import { benchmarkIterator } from './iterator_benchmark';

async function main() {
    let db: duckdb_serial.DuckDB | null = null;
    let adb: duckdb_parallel.AsyncDuckDB | null = null;
    let worker: Worker | null = null;

    const logger = new duckdb_serial.VoidLogger();
    db = new duckdb_serial.DuckDB(
        logger,
        duckdb_serial.NodeRuntime,
        path.resolve(__dirname, '../../duckdb/dist/duckdb.wasm'),
    );
    await db.open();
    worker = new Worker(path.resolve(__dirname, '../../duckdb/dist/duckdb-node-parallel.worker.js'));
    adb = new duckdb_parallel.AsyncDuckDB(logger, worker);
    await adb.open(path.resolve(__dirname, '../../duckdb/dist/duckdb.wasm'));

    benchmarkFormat(() => db!);
    benchmarkIterator(() => db!);
}

main();
