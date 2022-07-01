import dashql from '../dist/node/dashql_core.node';

export module parser {
    export function parseScript(text: string) {
        const ast = dashql.parser_parse_script(text);
        return new Uint8Array(ast);
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
        handle: dashql.Database;

        constructor(handle: dashql.Database) {
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
        handle: dashql.DatabaseConnection;

        constructor(handle: dashql.DatabaseConnection) {
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
        handle: dashql.DatabaseBuffer;

        constructor(handle: dashql.DatabaseBuffer) {
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
