import * as arrow from 'apache-arrow';

import { RawProxyError } from '../platform/channel_common.js';
import {
    HEADER_NAME_BATCH_BYTES,
    HEADER_NAME_BATCH_CHUNKS,
    HEADER_NAME_BATCH_EVENT,
    HEADER_NAME_BATCH_TIMEOUT,
    HEADER_NAME_CONNECTION_ID,
    HEADER_NAME_DATABASE_ID,
    HEADER_NAME_READ_TIMEOUT,
    HEADER_NAME_STATEMENT_ID,
    HEADER_NAME_STREAM_ID,
    HEADER_NAME_UPLOAD_ID,
} from '../platform/native_proxy_headers.js';
import {
    decodeArrowTable,
    DuckDB,
    DuckDBConnection,
    DuckDBInsertOptions,
    DuckDBOpenOptions,
    DuckDBPreparedStatement,
} from './duckdb_api.js';

const DEFAULT_PROXY_ENDPOINT = new URL('dashql-native://localhost');
const DEFAULT_READ_TIMEOUT_MS = 1000;
const DEFAULT_BATCH_TIMEOUT_MS = 1000;
const DEFAULT_BATCH_BYTES = 4_000_000;

export class NativeDuckDBError extends Error {
    details: Record<string, string>;

    constructor(error: RawProxyError) {
        super(error.message);
        this.details = error.details ?? {};
    }
}

async function throwIfError(response: Response): Promise<void> {
    if (response.headers.get('dashql-error') ?? false) {
        const proxyError = await response.json() as RawProxyError;
        throw new NativeDuckDBError(proxyError);
    }
    if (response.status < 200 || response.status >= 300) {
        let body: string | undefined;
        try {
            body = await response.text();
        } catch {
        }
        throw new NativeDuckDBError({ message: body ?? response.statusText });
    }
}

function requireHeaderAsNumber(response: Response, name: string): number {
    const value = response.headers.get(name);
    if (value == null) {
        throw new Error(`missing ${name} response header`);
    }
    const parsed = Number.parseInt(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`invalid ${name} response header`);
    }
    return parsed;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function decodeLengthPrefixedChunks(buffer: Uint8Array): Uint8Array[] {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < buffer.byteLength) {
        const length = view.getUint32(offset, true);
        offset += 4;
        chunks.push(buffer.slice(offset, offset + length));
        offset += length;
    }
    return chunks;
}

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(buffer.byteLength);
    copy.set(buffer);
    return copy.buffer;
}

export interface NativeDuckDBConfig {
    proxyEndpoint?: URL;
}

interface NativePendingBatch {
    bytes: Uint8Array;
    streamId: number | null;
}

export class NativeDuckDB extends DuckDB {
    protected databaseId: number | null = null;
    protected readonly proxyEndpoint: URL;

    constructor(config: NativeDuckDBConfig = {}) {
        super();
        this.proxyEndpoint = config.proxyEndpoint ?? DEFAULT_PROXY_ENDPOINT;
    }

    public detach(): void {
    }

    public terminate(): void {
        void this.destroyDatabase();
    }

    public async ping(): Promise<void> {
    }

    public async instantiate(_wasmUrl: string): Promise<void> {
    }

    public async open(options?: DuckDBOpenOptions): Promise<void> {
        const databaseId = await this.ensureDatabase();
        const response = await this.request(`/duckdb/database/${databaseId}/open`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify(options ?? {}),
        });
        await throwIfError(response);
    }

    public async reset(): Promise<void> {
        const databaseId = await this.ensureDatabase();
        const response = await this.request(`/duckdb/database/${databaseId}/reset`, {
            method: 'POST',
        });
        await throwIfError(response);
    }

    public async getVersion(): Promise<string> {
        const databaseId = await this.ensureDatabase();
        const response = await this.request(`/duckdb/database/${databaseId}/version`, {
            method: 'GET',
        });
        await throwIfError(response);
        return await response.text();
    }

    public async connect(): Promise<DuckDBConnection> {
        const databaseId = await this.ensureDatabase();
        const response = await this.request(`/duckdb/database/${databaseId}/connections`, {
            method: 'POST',
        });
        await throwIfError(response);
        const connectionId = requireHeaderAsNumber(response, HEADER_NAME_CONNECTION_ID);
        return new NativeDuckDBConnection(this, databaseId, connectionId);
    }

    protected async ensureDatabase(): Promise<number> {
        if (this.databaseId != null) {
            return this.databaseId;
        }
        const response = await this.request('/duckdb/databases', { method: 'POST' });
        await throwIfError(response);
        this.databaseId = requireHeaderAsNumber(response, HEADER_NAME_DATABASE_ID);
        return this.databaseId;
    }

    protected async destroyDatabase(): Promise<void> {
        if (this.databaseId == null) {
            return;
        }
        const databaseId = this.databaseId;
        this.databaseId = null;
        const response = await this.request(`/duckdb/database/${databaseId}`, { method: 'DELETE' });
        await throwIfError(response);
    }

    public async request(path: string, init?: RequestInit): Promise<Response> {
        const url = new URL(this.proxyEndpoint);
        url.pathname = path;
        return await fetch(new Request(url, init));
    }
}

export class NativeDuckDBConnection extends DuckDBConnection {
    protected pendingStreamId: number | null = null;

    constructor(
        protected readonly database: NativeDuckDB,
        protected readonly databaseId: number,
        protected readonly connectionId: number,
    ) {
        super();
    }

    protected async closeImpl(): Promise<void> {
        if (this.pendingStreamId != null) {
            await this.cancelPendingStream(this.pendingStreamId);
            this.pendingStreamId = null;
        }
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}`,
            { method: 'DELETE' },
        );
        await throwIfError(response);
    }

    protected async queryImpl(query: string): Promise<arrow.Table> {
        const streamId = await this.startQueryStream(query);
        const bytes = await this.readFullStream(streamId);
        return decodeArrowTable(bytes);
    }

    protected async queryPendingImpl(query: string, _allowStreamResult: boolean): Promise<arrow.Table> {
        const batch = await this.startPendingQuery(query);
        this.pendingStreamId = batch.streamId;
        return decodeArrowTable(batch.bytes);
    }

    protected async pollPendingImpl(): Promise<arrow.Table> {
        if (this.pendingStreamId == null) {
            throw new Error('No pending query');
        }
        const batch = await this.pollPendingQuery(this.pendingStreamId);
        this.pendingStreamId = batch.streamId;
        return decodeArrowTable(batch.bytes);
    }

    protected async cancelPendingImpl(): Promise<void> {
        if (this.pendingStreamId == null) {
            return;
        }
        await this.cancelPendingStream(this.pendingStreamId);
        this.pendingStreamId = null;
    }

    protected async fetchResultsImpl(): Promise<arrow.Table> {
        if (this.pendingStreamId == null) {
            throw new Error('No pending query');
        }
        const streamId = this.pendingStreamId;
        this.pendingStreamId = null;
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/pending/${streamId}/results`,
            { method: 'GET' },
        );
        await throwIfError(response);
        return decodeArrowTable(new Uint8Array(await response.arrayBuffer()));
    }

    protected async prepareImpl(query: string): Promise<DuckDBPreparedStatement> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/prepareds`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'text/plain',
                },
                body: query,
            },
        );
        await throwIfError(response);
        const statementId = requireHeaderAsNumber(response, HEADER_NAME_STATEMENT_ID);
        return new NativeDuckDBPreparedStatement(this, this.databaseId, this.connectionId, statementId);
    }

    protected async insertArrowIPCImpl(buffer: Uint8Array, options: DuckDBInsertOptions): Promise<void> {
        const createResponse = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/uploads`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: JSON.stringify(options),
            },
        );
        await throwIfError(createResponse);
        const uploadId = requireHeaderAsNumber(createResponse, HEADER_NAME_UPLOAD_ID);
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/upload/${uploadId}/finish`,
            {
                method: 'POST',
                body: toArrayBuffer(buffer),
            },
        );
        await throwIfError(response);
    }

    public async runPreparedStatement(statementId: number, params?: any): Promise<arrow.Table> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/prepared/${statementId}/run`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: params == null ? '{}' : JSON.stringify(params),
            },
        );
        await throwIfError(response);
        return decodeArrowTable(new Uint8Array(await response.arrayBuffer()));
    }

    public async sendPreparedStatement(statementId: number, params?: any): Promise<arrow.Table> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/prepared/${statementId}/send`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                body: params == null ? '{}' : JSON.stringify(params),
            },
        );
        await throwIfError(response);
        const streamHeader = response.headers.get(HEADER_NAME_STREAM_ID);
        this.pendingStreamId = streamHeader == null ? null : Number.parseInt(streamHeader);
        return decodeArrowTable(new Uint8Array(await response.arrayBuffer()));
    }

    public async closePreparedStatement(statementId: number): Promise<void> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/prepared/${statementId}`,
            { method: 'DELETE' },
        );
        await throwIfError(response);
    }

    protected async startQueryStream(query: string): Promise<number> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/query`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'text/plain',
                },
                body: query,
            },
        );
        await throwIfError(response);
        return requireHeaderAsNumber(response, HEADER_NAME_STREAM_ID);
    }

    protected async readStreamBatch(streamId: number): Promise<{ bytes: Uint8Array; finished: boolean }> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/stream/${streamId}`,
            {
                method: 'GET',
                headers: {
                    [HEADER_NAME_READ_TIMEOUT]: `${DEFAULT_READ_TIMEOUT_MS}`,
                    [HEADER_NAME_BATCH_TIMEOUT]: `${DEFAULT_BATCH_TIMEOUT_MS}`,
                    [HEADER_NAME_BATCH_BYTES]: `${DEFAULT_BATCH_BYTES}`,
                },
            },
        );
        await throwIfError(response);
        const batchEvent = response.headers.get(HEADER_NAME_BATCH_EVENT);
        const payload = new Uint8Array(await response.arrayBuffer());
        const chunkCount = Number.parseInt(response.headers.get(HEADER_NAME_BATCH_CHUNKS) ?? '0');
        const bytes = chunkCount > 0 ? concatChunks(decodeLengthPrefixedChunks(payload)) : new Uint8Array(0);
        return {
            bytes,
            finished: batchEvent === 'StreamFinished',
        };
    }

    protected async readFullStream(streamId: number): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        while (true) {
            const batch = await this.readStreamBatch(streamId);
            if (batch.bytes.byteLength > 0) {
                chunks.push(batch.bytes);
            }
            if (batch.finished) {
                return concatChunks(chunks);
            }
        }
    }

    protected async startPendingQuery(query: string): Promise<NativePendingBatch> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/pending`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'text/plain',
                },
                body: query,
            },
        );
        await throwIfError(response);
        const streamHeader = response.headers.get(HEADER_NAME_STREAM_ID);
        return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            streamId: streamHeader == null ? null : Number.parseInt(streamHeader),
        };
    }

    protected async pollPendingQuery(streamId: number): Promise<NativePendingBatch> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/pending/${streamId}`,
            { method: 'GET' },
        );
        await throwIfError(response);
        const nextStreamId = response.headers.get(HEADER_NAME_STREAM_ID);
        return {
            bytes: new Uint8Array(await response.arrayBuffer()),
            streamId: nextStreamId == null ? null : Number.parseInt(nextStreamId),
        };
    }

    protected async cancelPendingStream(streamId: number): Promise<void> {
        const response = await this.database.request(
            `/duckdb/database/${this.databaseId}/connection/${this.connectionId}/pending/${streamId}`,
            { method: 'DELETE' },
        );
        await throwIfError(response);
    }
}

export class NativeDuckDBPreparedStatement extends DuckDBPreparedStatement {
    constructor(
        protected readonly connection: NativeDuckDBConnection,
        protected readonly databaseId: number,
        protected readonly connectionId: number,
        protected readonly statementId: number,
    ) {
        super();
    }

    protected async closeImpl(): Promise<void> {
        await this.connection.closePreparedStatement(this.statementId);
    }

    protected async runImpl(params?: any): Promise<arrow.Table> {
        return await this.connection.runPreparedStatement(this.statementId, params);
    }

    protected async sendImpl(params?: any): Promise<arrow.Table> {
        return await this.connection.sendPreparedStatement(this.statementId, params);
    }
}

export async function createNativeDuckDB(config: NativeDuckDBConfig = {}, options?: DuckDBOpenOptions): Promise<NativeDuckDB> {
    const duckdb = new NativeDuckDB(config);
    await duckdb.ping();
    await duckdb.instantiate('');
    await duckdb.open(options);
    return duckdb;
}
