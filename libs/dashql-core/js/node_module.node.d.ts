declare module '*/dist/node/dashql_core.node' {
    function parser_parse_script(text: string): ArrayBuffer;

    interface Database {}
    interface DatabaseConnection {}
    interface DatabaseBuffer {}

    function database_open_in_memory(): Promise<Database>;
    function database_open(path: string): Promise<Database>;
    function database_close(db: Database): Promise<void>;
    function database_connection_create(db: Database): Promise<DatabaseConnection>;
    function database_connection_close(conn: DatabaseConnection): Promise<void>;
    function database_run_query(
        conn: DatabaseConnection,
        text: string,
        onSuccess: (buffer: DatabaseBuffer) => void,
        onError: (err: string) => void,
    ): Promise<DatabaseBuffer>;
    function database_buffer_access(buffer: DatabaseBuffer): ArrayBuffer;
    function database_buffer_delete(buffer: DatabaseBuffer): void;
}
