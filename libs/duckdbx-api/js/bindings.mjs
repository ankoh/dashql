export function configure() {
    return globalThis.DUCKDBX_RUNTIME.configure();
}
export function open(client, path) {
    return globalThis.DUCKDBX_RUNTIME.open(client, path);
}
export function close(db) {
    return globalThis.DUCKDBX_RUNTIME.close(db);
}
export function connect(db) {
    return globalThis.DUCKDBX_RUNTIME.connect(db);
}
export function disconnect(conn) {
    return globalThis.DUCKDBX_RUNTIME.disconnect(conn);
}
export function runQuery(conn, text) {
    return globalThis.DUCKDBX_RUNTIME.runQuery(conn, text);
}
