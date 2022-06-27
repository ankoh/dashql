declare module '*/duckdbx-node.node' {
    interface Database {}
    interface Connection {}
    interface Buffer {}

    declare async function openInMemory(): Promise<Database>;
    declare async function open(path: string): Promise<Database>;
    declare async function closeDatabase(db: Database): Promise<void>;
    declare async function connect(db: Database): Promise<Connection>;
    declare async function closeConnection(conn: Connection): Promise<void>;
    declare async function runQuery(
        conn: Connection,
        text: string,
        onSuccess: (buffer: Buffer) => void,
        onError: (err: string) => void,
    ): Promise<Buffer>;
    declare function accessBuffer(buffer: Buffer): ArrayBuffer;
    declare function deleteBuffer(buffer: Buffer): void;
}
