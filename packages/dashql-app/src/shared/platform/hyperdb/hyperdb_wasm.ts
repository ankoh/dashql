import * as arrow from 'apache-arrow';

import type {
    EmbeddedComputeDatabase,
    EmbeddedTableImportConnection,
    EmbeddedTableInsertOptions,
} from '../database/embedded_database.js';
import { Semaphore } from '../../utils/semaphore.js';

export type HyperDBResult =
    | { state: 'ok'; payload: Uint8Array }
    | { state: 'pending' }
    | { state: 'chunk'; payload: Uint8Array }
    | { state: 'done' }
    | { state: 'error'; error: string }
    | { state: 'busy'; error: string };

export interface HyperDBEngineClient {
    ready(): Promise<void>;
    connect(): Promise<HyperDBResult>;
    disconnect(connection: number): Promise<HyperDBResult>;
    startQuery(connection: number, sql: string): Promise<HyperDBResult>;
    insertArrowIPCFromPath(
        connection: number,
        path: string,
        name: string,
        schema: string | null,
        create: boolean,
        internal: boolean,
    ): Promise<HyperDBResult>;
    createTemporaryFile(bytes: Uint8Array): Promise<HyperDBResult>;
    removeFile(path: string): Promise<HyperDBResult>;
    pollQuery(query: number): Promise<HyperDBResult>;
    cancelQuery(query: number): Promise<HyperDBResult>;
    releaseQuery(query: number): Promise<HyperDBResult>;
    terminate(): Promise<void>;
}

function readError(result: HyperDBResult, operation: string): Error {
    if (result.state === 'error' || result.state === 'busy') {
        return new Error(result.error);
    }
    return new Error(`${operation} returned unexpected state ${result.state}`);
}

function expectOK(result: HyperDBResult, operation: string): asserts result is Extract<HyperDBResult, { state: 'ok' }> {
    if (result.state !== 'ok') {
        throw readError(result, operation);
    }
}

function readHandle(result: HyperDBResult, operation: string): number {
    expectOK(result, operation);
    if (result.payload.byteLength !== 4) {
        throw new Error(`${operation} returned an invalid handle`);
    }
    return new DataView(result.payload.buffer, result.payload.byteOffset, result.payload.byteLength).getUint32(0, true);
}

function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
    const result = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function decodeArrowTable(buffer: Uint8Array): arrow.Table {
    return new arrow.Table(arrow.RecordBatchReader.from(buffer));
}

function materializeDictionaryColumns(table: arrow.Table): arrow.Table {
    const dictionaryColumns = table.schema.fields
        .map((field, index) => arrow.DataType.isDictionary(field.type) ? index : -1)
        .filter(index => index !== -1);
    if (dictionaryColumns.length === 0) {
        return table;
    }

    const fields = table.schema.fields.map(field => arrow.DataType.isDictionary(field.type)
        ? field.clone({ type: (field.type as arrow.Dictionary).dictionary })
        : field);
    const batches = table.batches.map(batch => {
        let result = batch;
        for (const index of dictionaryColumns) {
            const column = result.getChildAt(index);
            const sourceField = table.schema.fields[index];
            if (!column || !sourceField) {
                throw new Error(`Arrow table is missing column ${index}`);
            }
            const dictionary = sourceField.type as arrow.Dictionary;
            result = result.setChildAt(index, arrow.vectorFromArray([...column], dictionary.dictionary));
        }
        return result;
    });
    return new arrow.Table(new arrow.Schema(fields, table.schema.metadata, null, table.schema.metadataVersion), batches);
}

function yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

export class HyperDB implements EmbeddedComputeDatabase {
    private readonly semaphore = new Semaphore(1);
    private connectionHandle: number | null = null;
    private initialization: Promise<void> | null = null;
    private termination: Promise<void> | null = null;
    private terminated = false;

    constructor(private readonly client: HyperDBEngineClient) {}

    static async create(client: HyperDBEngineClient): Promise<HyperDB> {
        const database = new HyperDB(client);
        await database.initialize();
        return database;
    }

    async connect(): Promise<HyperDBConnection> {
        await this.initialize();
        return new HyperDBConnection(this);
    }

    async getVersion(): Promise<string> {
        const connection = await this.connect();
        try {
            const result = await connection.query('SELECT version() AS version');
            const version = result.getChild('version')?.get(0);
            if (typeof version !== 'string') {
                throw new Error('version query returned an invalid result');
            }
            return version;
        } finally {
            await connection.close();
        }
    }

    async terminate(): Promise<void> {
        if (this.terminated) {
            return;
        }
        if (!this.termination) {
            this.termination = (async () => {
                const release = await this.semaphore.acquire();
                try {
                    if (this.connectionHandle !== null) {
                        expectOK(await this.client.disconnect(this.connectionHandle), 'disconnect');
                        this.connectionHandle = null;
                    }
                    await this.client.terminate();
                    this.terminated = true;
                } catch (error) {
                    this.termination = null;
                    throw error;
                } finally {
                    release();
                }
            })();
        }
        await this.termination;
    }

    async execute<T>(operation: (client: HyperDBEngineClient, connection: number) => Promise<T>): Promise<T> {
        await this.initialize();
        const release = await this.semaphore.acquire();
        try {
            if (this.terminated || this.connectionHandle === null) {
                throw new Error('database is terminated');
            }
            return await operation(this.client, this.connectionHandle);
        } finally {
            release();
        }
    }

    private async initialize(): Promise<void> {
        if (this.terminated) {
            throw new Error('database is terminated');
        }
        if (!this.initialization) {
            this.initialization = (async () => {
                await this.client.ready();
                this.connectionHandle = readHandle(await this.client.connect(), 'connect');
            })().catch(error => {
                this.initialization = null;
                throw error;
            });
        }
        await this.initialization;
    }
}

export class HyperDBConnection implements EmbeddedTableImportConnection {
    private closed = false;

    constructor(private readonly database: HyperDB) {}

    close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
    }

    async query(query: string): Promise<arrow.Table> {
        return decodeArrowTable(await this.queryArrowIPC(query));
    }

    async queryArrowIPC(query: string): Promise<Uint8Array> {
        this.checkOpen();
        return await this.database.execute(async (client, connection) => {
            let queryHandle: number | null = null;
            const chunks: Uint8Array[] = [];
            let byteLength = 0;
            let terminal = false;
            try {
                queryHandle = readHandle(await client.startQuery(connection, query), 'start query');
                for (;;) {
                    let result = await client.pollQuery(queryHandle);
                    while (result.state === 'pending') {
                        await yieldToEventLoop();
                        result = await client.pollQuery(queryHandle);
                    }
                    if (result.state === 'chunk') {
                        chunks.push(result.payload);
                        byteLength += result.payload.byteLength;
                        continue;
                    }
                    terminal = true;
                    if (result.state === 'done') {
                        return concatChunks(chunks, byteLength);
                    }
                    throw readError(result, 'poll query');
                }
            } finally {
                let cleanupError: unknown;
                if (queryHandle !== null && !terminal) {
                    try {
                        expectOK(await client.cancelQuery(queryHandle), 'cancel query');
                    } catch (error) {
                        cleanupError = error;
                    }
                }
                if (queryHandle !== null) {
                    try {
                        await this.releaseQuery(client, queryHandle);
                    } catch (error) {
                        cleanupError ??= error;
                    }
                }
                if (cleanupError) {
                    throw cleanupError;
                }
            }
        });
    }

    async insertArrowTable(table: arrow.Table, options: EmbeddedTableInsertOptions): Promise<void> {
        this.checkOpen();
        if (!options.name) {
            throw new Error('Arrow insert table name must not be empty');
        }
        await this.database.execute(async (client, connection) => {
            let path: string | null = null;
            try {
                const bytes = arrow.tableToIPC(materializeDictionaryColumns(table), 'stream');
                const temporaryFile = await client.createTemporaryFile(bytes);
                expectOK(temporaryFile, 'create temporary Arrow IPC file');
                path = new TextDecoder().decode(temporaryFile.payload);

                const queryHandle = readHandle(await client.insertArrowIPCFromPath(
                    connection,
                    path,
                    options.name,
                    options.schema ?? null,
                    options.create ?? true,
                    true,
                ), 'insert Arrow IPC from path');
                try {
                    for (;;) {
                        let result = await client.pollQuery(queryHandle);
                        while (result.state === 'pending') {
                            await yieldToEventLoop();
                            result = await client.pollQuery(queryHandle);
                        }
                        if (result.state === 'chunk') {
                            continue;
                        }
                        if (result.state === 'done') {
                            return;
                        }
                        throw readError(result, 'insert Arrow IPC from path');
                    }
                } finally {
                    await this.releaseQuery(client, queryHandle);
                }
            } finally {
                if (path !== null) {
                    expectOK(await client.removeFile(path), 'remove temporary Arrow IPC file');
                }
            }
        });
    }

    async createTableAs(name: string, query: string): Promise<void> {
        this.checkOpen();
        await this.queryArrowIPC(`CREATE TEMPORARY TABLE ${quoteIdentifier(name)} AS ${query}`);
    }

    private async releaseQuery(client: HyperDBEngineClient, query: number): Promise<void> {
        let delay = 1;
        for (;;) {
            const result = await client.releaseQuery(query);
            if (result.state === 'ok') {
                return;
            }
            if (result.state !== 'pending') {
                throw readError(result, 'release query');
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 32);
        }
    }

    private checkOpen(): void {
        if (this.closed) {
            throw new Error('connection is closed');
        }
    }
}

function quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}
