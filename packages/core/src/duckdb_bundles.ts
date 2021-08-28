import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

import duckdb_wasm from '@dashql/duckdb/dist/duckdb.wasm';
import duckdb_wasm_next from '@dashql/duckdb/dist/duckdb-next.wasm';
import duckdb_wasm_next_coi from '@dashql/duckdb/dist/duckdb-next-coi.wasm';

export const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: duckdb_wasm,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async.worker.js', import.meta.url).toString(),
    },
    asyncNext: {
        mainModule: duckdb_wasm_next,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next.worker.js', import.meta.url).toString(),
    },
    asyncNextCOI: {
        mainModule: duckdb_wasm_next_coi,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next-coi.worker.js', import.meta.url).toString(),
        pthreadWorker: new URL(
            '@dashql/duckdb/dist/duckdb-browser-async-next-coi.pthread.worker.js',
            import.meta.url,
        ).toString(),
    },
};
