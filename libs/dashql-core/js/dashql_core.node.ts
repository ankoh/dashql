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
        beginBatchUpdate(sessionId: number): void;
        endBatchUpdate(sessionId: number): void;
        updateProgram(sessionId: number, buffer: ArrayBuffer): void;
        updateTaskGraph(sessionId: number, graphJson: string): void;
        updateTaskData(sessionId: number, taskId: number, status: number, error: string | null): void;
        deleteTaskData(sessionId: number, stateId: number): void;
        updateInputData(sessionId: number, stateId: number): void;
        updateTableData(sessionId: number, stateId: number): void;
        updateVisualizationData(sessionId: number, stateId: number): void;
    }

    function workflow_configure_default(): void;
    function workflow_create_session(frontend: WorkflowFrontend): number;
    function workflow_close_session(callback: () => void, sessionId: number): void;
    function workflow_update_program(callback: () => void, sessionId: number, text: string): void;
    function workflow_update_program_input(callback: () => void, sessionId: number, values: string): void;
    function workflow_execute_program(callback: () => void, sessionId: number): void;
    function workflow_edit_program(callback: () => void, sessionId: number, edits: string): void;
    function workflow_run_query(sessionId: number, text: string): Uint8Array;
}
