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

    interface WorkflowFrontend {
        beginBatchUpdate(sessionId: number);
        endBatchUpdate(sessionId: number);
        updateProgram(sessionId: number, buffer: ArrayBuffer);
        updateTaskGraph(sessionId: number, graphJson: string);
        updateTaskStatus(sessionId: number, taskId: number, status: number, error: string | null);
        deleteTaskState(sessionId: number, stateId: number);
        updateInputState(sessionId: number, stateId: number);
        updateTableState(sessionId: number, stateId: number);
        updateVisualizationState(sessionId: number, stateId: number);
    }

    function workflow_configure_default(): void;
    function workflow_create_session(frontend: WorkflowFrontend): number;
    function workflow_close_session(sessionId: number, callback: () => void);
    function workflow_update_program(sessionId: number, text: string);
}
