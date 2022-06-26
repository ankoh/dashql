import duckdbx from '../dist/duckdbx.node';

export async function openInMemory() {
    const db = await duckdbx.openInMemory();
    return new Database(db);
}
export async function open(path: string) {
    const db = duckdbx.open(path);
    return new Database(db);
}

export class Database {
    handle: duckdbx.Database;

    constructor(handle: duckdbx.Database) {
        this.handle = handle;
    }
    public async connect(): Promise<Connection> {
        const conn = duckdbx.connect(this.handle);
        return new Connection(conn);
    }
    public async close(): Promise<void> {
        duckdbx.closeDatabase(this.handle);
    }
}

export class Connection {
    handle: duckdbx.Connection;

    constructor(handle: duckdbx.Connection) {
        this.handle = handle;
    }
    public async runQuery(text: string): Promise<Buffer> {
        return new Promise((onSuccess, onError) => {
            duckdbx.runQuery(this.handle, text, buffer => onSuccess(new Buffer(buffer)), onError);
        });
    }
    public async close(): Promise<void> {
        duckdbx.closeConnection(this.handle);
    }
}

export class Buffer {
    handle: duckdbx.Buffer;

    constructor(handle: duckdbx.Buffer) {
        this.handle = handle;
    }
    public access(): Uint8Array {
        const buffer = duckdbx.accessBuffer(this.handle);
        return new Uint8Array(buffer);
    }
    public delete() {
        duckdbx.deleteBuffer(this.handle);
    }
}
