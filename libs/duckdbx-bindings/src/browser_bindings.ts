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
let duckdbBundle: duckdb.DuckDBBundle | null = null;

async function createClient() {
    if (duckdbBundle != null) {
        duckdbBundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
    }
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const worker = new Worker(duckdbBundle!.mainWorker!);
    return new duckdb.AsyncDuckDB(logger, worker);
}

async function openDatabase(db: duckdb.AsyncDuckDB, path: string) {
    if (path !== undefined && path !== null) {
        await db.open({
            path: path,
        });
    }
    return db;
}
async function closeDatabase(db: duckdb.AsyncDuckDB) {
    return await db.terminate();
}
async function createConnection(db: duckdb.AsyncDuckDB) {
    return await db.connect();
}
async function closeConnection(conn: duckdb.AsyncDuckDBConnection) {
    return await conn.close();
}
async function runQuery(conn: duckdb.AsyncDuckDBConnection, text: string) {
    const id = conn.useUnsafe((_, c) => c);
    return await conn.bindings.runQuery(id, text);
}
function accessBuffer(buffer: Uint8Array) {
    return buffer;
}
function deleteBuffer(_buffer: Uint8Array) {}

export function register(global: any) {
    global.DUCKDBX_RUNTIME = {
        createClient,
        openDatabase,
        closeDatabase,
        createConnection,
        closeConnection,
        runQuery,
        accessBuffer,
        deleteBuffer,
    };
}
