export async function createClient() {
    return await globalThis.DASHQL_RUNTIME.database.createClient();
}
export async function openDatabase(db, path) {
    return await globalThis.DASHQL_RUNTIME.database.open(db, path);
}
export async function closeDatabase(db) {
    return await globalThis.DASHQL_RUNTIME.database.close(db);
}
export async function createConnection(db) {
    return await globalThis.DASHQL_RUNTIME.database.createConnection(db);
}
export async function closeConnection(conn) {
    return await globalThis.DASHQL_RUNTIME.database.closeConnection(conn);
}
export async function runQuery(conn, text) {
    return await globalThis.DASHQL_RUNTIME.database.runQuery(conn, text);
}
export function accessBuffer(buffer) {
    return globalThis.DASHQL_RUNTIME.database.accessBuffer(buffer);
}
export function deleteBuffer(buffer) {
    return globalThis.DASHQL_RUNTIME.database.deleteBuffer(buffer);
}
