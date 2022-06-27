import * as duckdbx from '@dashql/duckdbx-node';

async function createClient() {
    return null;
}
async function openDatabase(_client: null, path: string) {
    if (path === null) {
        return duckdbx.openInMemory();
    } else {
        return duckdbx.open(path);
    }
}
async function closeDatabase(db: duckdbx.Database) {
    return db.close();
}
async function createConnection(db: duckdbx.Database) {
    return db.connect();
}
async function closeConnection(conn: duckdbx.Connection) {
    return conn.close();
}
async function runQuery(conn: duckdbx.Connection, text: string) {
    return await conn.runQuery(text);
}
function accessBuffer(buffer: duckdbx.Buffer) {
    return buffer.access();
}
function deleteBuffer(buffer: duckdbx.Buffer) {
    return buffer.delete();
}

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
