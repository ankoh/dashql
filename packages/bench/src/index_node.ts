import * as duckdb_serial from '@dashql/duckdb/dist/duckdb-node';
import * as duckdb_parallel from '@dashql/duckdb/dist/duckdb-node-parallel';
import path from 'path';
import Worker from 'web-worker';
import initSqlJs from 'sql.js';

import { benchmarkFormat } from './format_benchmark';
import { benchmarkIterator } from './iterator_benchmark';
import { benchmarkIteratorAsync } from './iterator_benchmark_async';
import { benchmarkCompetitions } from './competition_benchmark';

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

    const SQL = await initSqlJs();
    let sqlDb = new SQL.Database();

    await benchmarkCompetitions(
        () => db!,
        () => sqlDb!,
    );
    // benchmarkFormat(() => db!);
    // benchmarkIterator(() => db!);
    // benchmarkIteratorAsync(() => adb!);
}

main();
