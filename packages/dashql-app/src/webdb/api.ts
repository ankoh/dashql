import * as arrow from 'apache-arrow';
import {
    WebDBWorkerRequestType,
    WebDBWorkerRequestVariant,
    WebDBWorkerResponseType,
    WebDBWorkerResponseVariant,
    WebDBWorkerTask,
    WebDBWorkerTaskVariant,
    WebDBWorkerTaskReturnType,
    WebDBOpenOptions,
    WebDBInsertOptions,
} from './webdb_worker_request.js';

/**
 * WebDB API - Wrapper for DuckDB-WASM in a Web Worker
 *
 * This API provides a high-level interface to interact with DuckDB running in a web worker.
 * Unlike the core dashql-compute API, this uses DuckDB-WASM which requires running in a
 * dedicated web worker for proper threading support.
 */
export class WebDB {
    /// The worker instance
    protected worker: Worker;
    /// The next message id
    protected nextMessageId: number;
    /// Pending tasks
    protected pendingTasks: Map<number, WebDBWorkerTaskVariant>;
    /// Message handler
    protected onMessageHandler: (event: MessageEvent<WebDBWorkerResponseVariant>) => void;

    constructor(worker: Worker) {
        this.worker = worker;
        this.nextMessageId = 0;
        this.pendingTasks = new Map();

        this.onMessageHandler = this.onMessage.bind(this);
        this.worker.addEventListener('message', this.onMessageHandler);
    }

    /// Detach from the worker
    public detach(): void {
        this.worker.removeEventListener('message', this.onMessageHandler);
    }

    /// Terminate the worker
    public terminate(): void {
        this.detach();
        this.worker.terminate();
    }

    /// Handle a message from the worker
    protected onMessage(event: MessageEvent<WebDBWorkerResponseVariant>): void {
        const response = event.data;
        const task = this.pendingTasks.get(response.requestId);
        if (!task) {
            console.warn(`Received response for unknown request ${response.requestId}`);
            return;
        }

        switch (response.type) {
            case WebDBWorkerResponseType.OK:
                task.promiseResolver(null as any);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.ERROR:
                const error = new Error(response.data.message);
                error.name = response.data.name;
                if (response.data.stack) {
                    error.stack = response.data.stack;
                }
                task.promiseRejecter(error);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.VERSION:
                task.promiseResolver(response.data as any);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.CONNECTION_ID:
                task.promiseResolver(response.data as any);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.ARROW_BUFFER:
                task.promiseResolver(response.data as any);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.PREPARED_STATEMENT_ID:
                task.promiseResolver(response.data as any);
                this.pendingTasks.delete(response.requestId);
                break;

            case WebDBWorkerResponseType.QUERY_RESULT_CHUNK:
            case WebDBWorkerResponseType.QUERY_RESULT_COMPLETE:
                // For streaming results (if implemented in the future)
                break;

            default:
                console.warn(`Unknown response type: ${(response as any).type}`);
                break;
        }
    }

    /// Post a request to the worker
    protected postRequest<T extends WebDBWorkerTaskVariant>(task: T): Promise<WebDBWorkerTaskReturnType<T>> {
        const messageId = this.nextMessageId++;
        const request: WebDBWorkerRequestVariant = {
            messageId,
            type: task.type as any,
            data: task.data as any,
        } as WebDBWorkerRequestVariant;

        this.pendingTasks.set(messageId, task as WebDBWorkerTaskVariant);
        this.worker.postMessage(request);

        return task.promise as Promise<WebDBWorkerTaskReturnType<T>>;
    }

    /// Ping the worker
    public async ping(): Promise<void> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.PING, null, null>(WebDBWorkerRequestType.PING, null);
        await this.postRequest(task);
    }

    /// Instantiate the WASM module
    public async instantiate(wasmUrl: string): Promise<void> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.INSTANTIATE, { wasmUrl: string }, null>(WebDBWorkerRequestType.INSTANTIATE, { wasmUrl });
        await this.postRequest(task);
    }

    /// Open the database
    public async open(options?: WebDBOpenOptions): Promise<void> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.OPEN, WebDBOpenOptions, null>(WebDBWorkerRequestType.OPEN, options || {});
        await this.postRequest(task);
    }

    /// Reset the database
    public async reset(): Promise<void> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.RESET, null, null>(WebDBWorkerRequestType.RESET, null);
        await this.postRequest(task);
    }

    /// Get the DuckDB version
    public async getVersion(): Promise<string> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.GET_VERSION, null, { version: string }>(WebDBWorkerRequestType.GET_VERSION, null);
        const result = await this.postRequest(task) as { version: string };
        return result.version;
    }

    /// Create a new connection
    public async connect(): Promise<WebDBConnection> {
        const task = new WebDBWorkerTask<WebDBWorkerRequestType.CONNECT, null, { connectionId: number }>(WebDBWorkerRequestType.CONNECT, null);
        const result = await this.postRequest(task) as { connectionId: number };
        return new WebDBConnection(this, result.connectionId);
    }
}

/**
 * WebDB Connection - Represents a connection to the database
 */
export class WebDBConnection {
    protected webdb: WebDB;
    protected connectionId: number;
    protected closed: boolean;

    constructor(webdb: WebDB, connectionId: number) {
        this.webdb = webdb;
        this.connectionId = connectionId;
        this.closed = false;
    }

    protected checkClosed(): void {
        if (this.closed) {
            throw new Error('Connection is closed');
        }
    }

    /// Close the connection
    public async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.DISCONNECT, {
            connectionId: this.connectionId,
        });
        await this.webdb['postRequest'](task) as null;
    }

    /// Run a query and return the full result as Arrow Table
    public async query(query: string): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_RUN, {
            connectionId: this.connectionId,
            query,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }

    /// Start a pending query (for streaming results)
    public async queryPending(query: string, allowStreamResult: boolean = false): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_START, {
            connectionId: this.connectionId,
            query,
            allowStreamResult,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer (schema)
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }

    /// Poll a pending query
    public async pollPending(): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_POLL, {
            connectionId: this.connectionId,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }

    /// Cancel a pending query
    public async cancelPending(): Promise<void> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_CANCEL, {
            connectionId: this.connectionId,
        });
        await this.webdb['postRequest'](task);
    }

    /// Fetch query results
    public async fetchResults(): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_FETCH_RESULTS, {
            connectionId: this.connectionId,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }

    /// Create a prepared statement
    public async prepare(query: string): Promise<WebDBPreparedStatement> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_CREATE, {
            connectionId: this.connectionId,
            query,
        });
        const result = await this.webdb['postRequest'](task) as { statementId: number };
        return new WebDBPreparedStatement(this.webdb, this.connectionId, result.statementId);
    }

    /// Insert Arrow data from IPC stream
    public async insertArrowIPC(buffer: Uint8Array, options: WebDBInsertOptions): Promise<void> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.INSERT_ARROW_IPC, {
            connectionId: this.connectionId,
            buffer,
            options,
        });
        await this.webdb['postRequest'](task) as null;
    }

    /// Insert an Arrow table
    public async insertArrowTable(table: arrow.Table, options: WebDBInsertOptions): Promise<void> {
        this.checkClosed();

        // Convert table to IPC stream
        const buffer = arrow.tableToIPC(table, 'stream');
        await this.insertArrowIPC(buffer, options);
    }
}

/**
 * WebDB Prepared Statement
 */
export class WebDBPreparedStatement {
    protected webdb: WebDB;
    protected connectionId: number;
    protected statementId: number;
    protected closed: boolean;

    constructor(webdb: WebDB, connectionId: number, statementId: number) {
        this.webdb = webdb;
        this.connectionId = connectionId;
        this.statementId = statementId;
        this.closed = false;
    }

    protected checkClosed(): void {
        if (this.closed) {
            throw new Error('Prepared statement is closed');
        }
    }

    /// Close the prepared statement
    public async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_CLOSE, {
            connectionId: this.connectionId,
            statementId: this.statementId,
        });
        await this.webdb['postRequest'](task) as null;
    }

    /// Run the prepared statement and return full result
    public async run(params?: any): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_RUN, {
            connectionId: this.connectionId,
            statementId: this.statementId,
            params,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }

    /// Send the prepared statement for streaming results
    public async send(params?: any): Promise<arrow.Table> {
        this.checkClosed();

        const task = new WebDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_SEND, {
            connectionId: this.connectionId,
            statementId: this.statementId,
            params,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };

        // Parse Arrow IPC buffer (schema)
        const reader = arrow.RecordBatchReader.from(result.buffer);
        return new arrow.Table(reader);
    }
}

/**
 * Create a WebDB instance with a worker
 */
export async function createWebDB(workerUrl: string, wasmUrl: string, options?: WebDBOpenOptions): Promise<WebDB> {
    const worker = new Worker(workerUrl, { type: 'module' });
    const webdb = new WebDB(worker);

    await webdb.ping();
    await webdb.instantiate(wasmUrl);
    await webdb.open(options);

    return webdb;
}
