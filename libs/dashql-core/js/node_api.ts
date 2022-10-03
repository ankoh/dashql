import dashql from '../dist/node/dashql_core.node';

export module parser {
    export function parseScript(text: string) {
        const ast = dashql.parser_parse_script(text);
        return new Uint8Array(ast);
    }
}

export module workflow {
    export function configureDefault(): void {
        dashql.workflow_configure_default();
    }
    export function createSession(workflow: dashql.WorkflowFrontend): number {
        return dashql.workflow_create_session(workflow);
    }
    export function closeSession(resolve: () => void, sessionId: number) {
        dashql.workflow_close_session(resolve, sessionId);
    }
    export function executeProgram(resolve: () => void, sessionId: number) {
        dashql.workflow_execute_program(resolve, sessionId);
    }
    export function updateProgram(resolve: () => void, sessionId: number, text: string) {
        dashql.workflow_update_program(resolve, sessionId, text);
    }
    export function updateProgramInput(resolve: () => void, sessionId: number, values: string) {
        dashql.workflow_update_program_input(resolve, sessionId, values);
    }
    export function editProgram(resolve: () => void, sessionId: number, edits: string) {
        dashql.workflow_edit_program(resolve, sessionId, edits);
    }
    export function runQuery(sessionId: number, text: string) {
        const buffer = dashql.workflow_run_query(sessionId, text);
        return new Uint8Array(buffer);
    }
}

export module database {
    export function openInMemory() {
        const db = dashql.database_open_in_memory();
        return new Database(db);
    }
    export function open(path: string) {
        const db = dashql.database_open(path);
        return new Database(db);
    }

    export class Database {
        handle: any;

        constructor(handle: any) {
            this.handle = handle;
        }
        public connect(): DatabaseConnection {
            const conn = dashql.database_connection_create(this.handle);
            return new DatabaseConnection(conn);
        }
        public close() {
            dashql.database_close(this.handle);
        }
    }

    export class DatabaseConnection {
        handle: any;

        constructor(handle: any) {
            this.handle = handle;
        }
        public async runQuery(text: string): Promise<DatabaseBuffer> {
            return new Promise((onSuccess, onError) => {
                dashql.database_run_query(this.handle, text, buffer => onSuccess(new DatabaseBuffer(buffer)), onError);
            });
        }
        public close() {
            dashql.database_connection_close(this.handle);
        }
    }

    export class DatabaseBuffer {
        handle: any;

        constructor(handle: any) {
            this.handle = handle;
        }
        public access(): Uint8Array {
            const buffer = dashql.database_buffer_access(this.handle);
            return new Uint8Array(buffer);
        }
        public delete() {
            dashql.database_buffer_delete(this.handle);
        }
    }
}
