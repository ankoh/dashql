import path from 'node:path';

import type { HyperDBConnection, HyperDBSettings } from 'hyperdb-wasm';

import { quoteIdentifier } from '../src/quote.js';
import { acquireDatabaseLock } from '../src/node/database_lock.js';
import { openEngine, type OpenEngine } from '../src/node/open_engine.js';

/// The engine settings of a store, on top of the defaults of openEngine
export const STORE_ENGINE_SETTINGS: HyperDBSettings = Object.freeze({
    // Hyper writes an attached database to its file only when it detaches it, a killed process loses every write
    // since. With the redo log every commit goes to <file>.dblog and the next attach replays it.
    experimental_redo_log: true,
    // Persisted real[] columns, for the embeddings of the LangGraph store
    experimental_data_type_persistence: true,
});

/// A row of a result: Utf8 and json as string, Int64 as bigint, timestamps as milliseconds, bytea as Uint8Array,
/// lists as arrays
export type Row = Record<string, unknown>;

/// Runs statements, the database itself or the statements of a transaction
export interface SqlRunner {
    /// Run a statement that returns rows
    query(sql: string): Promise<Row[]>;
    /// Run a statement without rows, returns the rows it changed
    execute(sql: string): Promise<bigint | null>;
}

export interface HyperDatabaseOptions {
    /// The .hyper file, created when missing. Its folder must exist; the engine writes its logs/ there as well.
    readonly file: string;
    /// Engine settings on top of STORE_ENGINE_SETTINGS
    readonly settings?: HyperDBSettings;
}

function plainValue(value: unknown): unknown {
    // Arrow lists come as vectors
    if (value != null && typeof value === 'object' && !(value instanceof Uint8Array) && typeof (value as { toArray?: unknown }).toArray === 'function') {
        return Array.from((value as { toArray(): ArrayLike<unknown> }).toArray(), plainValue);
    }
    return value;
}

async function queryRows(connection: HyperDBConnection, sql: string): Promise<Row[]> {
    const table = await connection.query(sql);
    const rows: Row[] = [];
    for (const row of table) {
        const plain: Row = {};
        for (const [name, value] of Object.entries(row.toJSON())) plain[name] = plainValue(value);
        rows.push(plain);
    }
    return rows;
}

/// A hot Hyper with one database file that the stores of the agent libraries keep their tables in.
/// One engine per file: open() locks the file for the process (a second open fails with DatabaseInUseError), and all
/// stores of the process share the database. Statements run one at a time, in the order of the calls.
export class HyperDatabase implements SqlRunner {
    private queue: Promise<unknown> = Promise.resolve();
    private closed = false;

    private constructor(
        private readonly engine: OpenEngine,
        private readonly releaseLock: () => void,
        /// The absolute path of the database file
        readonly file: string,
    ) {}

    static async open(options: HyperDatabaseOptions): Promise<HyperDatabase> {
        const file = path.resolve(options.file);
        const releaseLock = acquireDatabaseLock(file);
        try {
            const engine = await openEngine({
                database: file,
                workDirectory: path.dirname(file),
                settings: { ...STORE_ENGINE_SETTINGS, ...options.settings },
            });
            return new HyperDatabase(engine, releaseLock, file);
        } catch (e) {
            releaseLock();
            throw e;
        }
    }

    /// The qualified name of a table of the database
    table(name: string): string {
        return `${quoteIdentifier(this.engine.databaseName!)}.public.${quoteIdentifier(name)}`;
    }

    query(sql: string): Promise<Row[]> {
        return this.serialize(() => queryRows(this.engine.connection, sql));
    }

    execute(sql: string): Promise<bigint | null> {
        return this.serialize(() => this.engine.connection.execute(sql));
    }

    /// Run the statements of body in one transaction: all of them commit or none. Inside body, run statements only
    /// through the runner it gets, a call of the database itself waits for the transaction and never runs.
    transaction<T>(body: (tx: SqlRunner) => Promise<T>): Promise<T> {
        return this.serialize(async () => {
            const connection = this.engine.connection;
            await connection.execute('BEGIN');
            try {
                const result = await body({
                    query: (sql) => queryRows(connection, sql),
                    execute: (sql) => connection.execute(sql),
                });
                await connection.execute('COMMIT');
                return result;
            } catch (e) {
                await connection.execute('ROLLBACK').catch(() => {});
                throw e;
            }
        });
    }

    /// Wait for the running statements, stop the engine and release the lock
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        await this.queue;
        try {
            await this.engine.close();
        } finally {
            this.releaseLock();
        }
    }

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        if (this.closed) return Promise.reject(new Error(`the database ${this.file} is closed`));
        const run = this.queue.then(operation, operation);
        this.queue = run.catch(() => {});
        return run;
    }
}

const SETUPS = new WeakMap<HyperDatabase, Map<string, Promise<void>>>();

/// Run the statements that create the tables of a store once per database and tables
export function setupOnce(database: HyperDatabase, statements: string[]): Promise<void> {
    let done = SETUPS.get(database);
    if (done == null) {
        done = new Map();
        SETUPS.set(database, done);
    }
    const key = statements.join(';\n');
    let setup = done.get(key);
    if (setup == null) {
        setup = (async () => {
            for (const statement of statements) await database.execute(statement);
        })();
        done.set(key, setup);
        setup.catch(() => done.delete(key));
    }
    return setup;
}
