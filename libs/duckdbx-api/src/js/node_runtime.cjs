const duckdbx = require('duckdbx-neon');

async function createClient() {
    return null;
}
async function openDatabase(_client, path) {
    if (path === null) {
        return duckdbx.openInMemory();
    } else {
        return duckdbx.open(path);
    }
}
async function closeDatabase(db) {
    return db.close();
}
async function createConnection(db) {
    return db.connect();
}
async function closeConnection(conn) {
    return conn.close();
}
async function runQuery(conn, text) {
    return await conn.runQuery(text);
}
function accessBuffer(buffer) {
    return buffer.access();
}
function deleteBuffer(buffer) {
    return buffer.delete();
}

module.exports = {
    createClient,
    openDatabase,
    closeDatabase,
    createConnection,
    closeConnection,
    runQuery,
    accessBuffer,
    deleteBuffer,
};
