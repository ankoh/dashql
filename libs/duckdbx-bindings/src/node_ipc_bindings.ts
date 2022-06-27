import * as duckdbx from '@dashql/duckdbx-node';

export async function createClient() {}
export async function openDatabase(_client: any, _path: any) {}
export async function closeDatabase(_db: any) {}
export async function createConnection(_db: any) {}
export async function closeConnection(_db: any) {}
export async function runQuery(_conn: any, _text: any) {}
function accessBuffer(_buffer: duckdbx.Buffer) {}
function deleteBuffer(_buffer: duckdbx.Buffer) {}

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
