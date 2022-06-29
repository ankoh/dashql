declare module '*/dist/node/dashql-core.node' {
    interface Database {}
    interface Connection {}
    interface Buffer {}

    function openInMemory(): Promise<Database>;
    function open(path: string): Promise<Database>;
    function closeDatabase(db: Database): Promise<void>;
    function connect(db: Database): Promise<Connection>;
    function closeConnection(conn: Connection): Promise<void>;
    function runQuery(
        conn: Connection,
        text: string,
        onSuccess: (buffer: Buffer) => void,
        onError: (err: string) => void,
    ): Promise<Buffer>;
    function accessBuffer(buffer: Buffer): ArrayBuffer;
    function deleteBuffer(buffer: Buffer): void;
}
