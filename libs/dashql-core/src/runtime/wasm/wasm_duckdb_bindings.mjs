export async function createClient() {
    return await globalThis.DUCKDBX_BINDINGS.createClient();
}
export async function openDatabase(db, path) {
    return await globalThis.DUCKDBX_BINDINGS.openDatabase(db, path);
}
export async function closeDatabase(db) {
    return await globalThis.DUCKDBX_BINDINGS.closeDatabase(db);
}
export async function createConnection(db) {
    return await globalThis.DUCKDBX_BINDINGS.createConnection(db);
}
export async function closeConnection(conn) {
    return await globalThis.DUCKDBX_BINDINGS.closeConnection(conn);
}
export async function runQuery(conn, text) {
    return await globalThis.DUCKDBX_BINDINGS.runQuery(conn, text);
}
export function accessBuffer(buffer) {
    return globalThis.DUCKDBX_BINDINGS.accessBuffer(buffer);
}
export function deleteBuffer(buffer) {
    return globalThis.DUCKDBX_BINDINGS.deleteBuffer(buffer);
}
