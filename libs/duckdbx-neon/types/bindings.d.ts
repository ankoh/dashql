declare module '*/duckdbx.node' {
    interface Database {}
    interface Connection {}
    interface Buffer {}

    declare async function openInMemory(): Promise<Database>;
    declare async function open(path: string): Promise<Database>;
    declare async function closeDatabase(db: Database): Promise<void>;
    declare async function connect(db: Database): Promise<Connection>;
    declare async function closeConnection(conn: Connection): Promise<void>;
    declare async function runQuery(conn: Connection, text: string): Promise<Buffer>;
    declare async function accessBuffer(buffer: Buffer): Promise<ArrayBuffer>;
    declare async function deleteBuffer(buffer: Buffer): Promise<void>;
}
