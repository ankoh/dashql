export async function createClient() {
    return await globalThis.DASHQL_DATABASE.createClient();
}
export async function openDatabase(db, path) {
    return await globalThis.DASHQL_DATABASE.open(db, path);
}
export async function closeDatabase(db) {
    return await globalThis.DASHQL_DATABASE.close(db);
}
export async function createConnection(db) {
    return await globalThis.DASHQL_DATABASE.createConnection(db);
}
export async function closeConnection(conn) {
    return await globalThis.DASHQL_DATABASE.closeConnection(conn);
}
export async function runQuery(conn, text) {
    return await globalThis.DASHQL_DATABASE.runQuery(conn, text);
}
export function accessBuffer(buffer) {
    return globalThis.DASHQL_DATABASE.accessBuffer(buffer);
}
export function deleteBuffer(buffer) {
    return globalThis.DASHQL_DATABASE.deleteBuffer(buffer);
}
