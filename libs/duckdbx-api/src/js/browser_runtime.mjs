import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm';

const DUCKDB_BUNDLES = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js', import.meta.url).toString(),
    },
    eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: new URL('@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js', import.meta.url).toString(),
    },
};
let duckdbBundle = null;

export async function createClient() {
    if (duckdbBundle != null) {
        duckdbBundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
    }
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const worker = new Worker(duckdbBundle.mainWorker);
    return new duckdb.AsyncDuckDB(logger, worker);
}

export async function openDatabase(db, path) {
    if (path !== undefined && path !== null) {
        await db.open({
            path: path,
        });
    }
    return db;
}
export async function closeDatabase(db) {
    return await db.terminate();
}
export async function createConnection(db) {
    return await db.connect();
}
export async function closeConnection(conn) {
    return await conn.close();
}
export async function runQuery(conn, text) {
    const id = conn.useUnsafe((_, c) => c);
    return await conn.bindings.runQuery(id, text);
}
export function accessBuffer(buffer) {
    return buffer;
}
export function deleteBuffer(_) {}
