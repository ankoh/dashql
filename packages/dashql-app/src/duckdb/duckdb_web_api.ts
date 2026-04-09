import * as arrow from 'apache-arrow';

import {
    decodeArrowTable,
    DuckDB,
    DuckDBConnection,
    DuckDBInsertOptions,
    DuckDBOpenOptions,
    DuckDBPreparedStatement,
} from './duckdb_api.js';
import {
    WebDBWorkerRequestType,
    WebDBWorkerRequestVariant,
    WebDBWorkerResponseType,
    WebDBWorkerResponseVariant,
    DuckDBWorkerTask,
    DuckDBWorkerTaskVariant,
    DuckDBWorkerTaskReturnType,
} from './duckdb_worker_request.js';

export class WebDuckDB extends DuckDB {
    protected worker: Worker;
    protected nextMessageId: number;
    protected pendingTasks: Map<number, DuckDBWorkerTaskVariant>;
    protected onMessageHandler: (event: MessageEvent<WebDBWorkerResponseVariant>) => void;

    constructor(worker: Worker) {
        super();
        this.worker = worker;
        this.nextMessageId = 0;
        this.pendingTasks = new Map();
        this.onMessageHandler = this.onMessage.bind(this);
        this.worker.addEventListener('message', this.onMessageHandler);
    }

    public detach(): void {
        this.worker.removeEventListener('message', this.onMessageHandler);
    }

    public terminate(): void {
        this.detach();
        this.worker.terminate();
    }

    protected onMessage(event: MessageEvent<WebDBWorkerResponseVariant>): void {
        const response = event.data;
        const task = this.pendingTasks.get(response.requestId);
        if (!task) {
            console.warn(`Received response for unknown request ${response.requestId}`);
            return;
        }

        switch (response.type) {
            case WebDBWorkerResponseType.OK:
                task.promiseResolver(null as never);
                this.pendingTasks.delete(response.requestId);
                break;
            case WebDBWorkerResponseType.ERROR: {
                const error = new Error(response.data.message);
                error.name = response.data.name;
                if (response.data.stack) {
                    error.stack = response.data.stack;
                }
                task.promiseRejecter(error);
                this.pendingTasks.delete(response.requestId);
                break;
            }
            case WebDBWorkerResponseType.VERSION:
            case WebDBWorkerResponseType.CONNECTION_ID:
            case WebDBWorkerResponseType.ARROW_BUFFER:
            case WebDBWorkerResponseType.PREPARED_STATEMENT_ID:
                task.promiseResolver(response.data as never);
                this.pendingTasks.delete(response.requestId);
                break;
            case WebDBWorkerResponseType.QUERY_RESULT_CHUNK:
            case WebDBWorkerResponseType.QUERY_RESULT_COMPLETE:
                break;
            default:
                console.warn(`Unknown response type: ${(response as any).type}`);
                break;
        }
    }

    protected postRequest<T extends DuckDBWorkerTaskVariant>(task: T): Promise<DuckDBWorkerTaskReturnType<T>> {
        const messageId = this.nextMessageId++;
        const request: WebDBWorkerRequestVariant = {
            messageId,
            type: task.type as any,
            data: task.data as any,
        } as WebDBWorkerRequestVariant;
        this.pendingTasks.set(messageId, task);
        this.worker.postMessage(request);
        return task.promise as Promise<DuckDBWorkerTaskReturnType<T>>;
    }

    public async ping(): Promise<void> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.PING, null, null>(WebDBWorkerRequestType.PING, null);
        await this.postRequest(task);
    }

    public async instantiate(wasmUrl: string): Promise<void> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.INSTANTIATE, { wasmUrl: string }, null>(
            WebDBWorkerRequestType.INSTANTIATE,
            { wasmUrl },
        );
        await this.postRequest(task);
    }

    public async open(options?: DuckDBOpenOptions): Promise<void> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.OPEN, DuckDBOpenOptions, null>(
            WebDBWorkerRequestType.OPEN,
            options || {},
        );
        await this.postRequest(task);
    }

    public async reset(): Promise<void> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.RESET, null, null>(WebDBWorkerRequestType.RESET, null);
        await this.postRequest(task);
    }

    public async getVersion(): Promise<string> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.GET_VERSION, null, { version: string }>(
            WebDBWorkerRequestType.GET_VERSION,
            null,
        );
        const result = await this.postRequest(task);
        return result.version;
    }

    public async connect(): Promise<DuckDBConnection> {
        const task = new DuckDBWorkerTask<WebDBWorkerRequestType.CONNECT, null, { connectionId: number }>(
            WebDBWorkerRequestType.CONNECT,
            null,
        );
        const result = await this.postRequest(task);
        return new WebDuckDBConnection(this, result.connectionId);
    }
}

export class WebDuckDBConnection extends DuckDBConnection {
    constructor(
        protected webdb: WebDuckDB,
        protected connectionId: number,
    ) {
        super();
    }

    protected async closeImpl(): Promise<void> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.DISCONNECT, {
            connectionId: this.connectionId,
        });
        await this.webdb['postRequest'](task);
    }

    protected async queryImpl(query: string): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_RUN, {
            connectionId: this.connectionId,
            query,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }

    protected async queryPendingImpl(query: string, allowStreamResult: boolean): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_START, {
            connectionId: this.connectionId,
            query,
            allowStreamResult,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }

    protected async pollPendingImpl(): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_POLL, {
            connectionId: this.connectionId,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }

    protected async cancelPendingImpl(): Promise<void> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_PENDING_CANCEL, {
            connectionId: this.connectionId,
        });
        await this.webdb['postRequest'](task);
    }

    protected async fetchResultsImpl(): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.QUERY_FETCH_RESULTS, {
            connectionId: this.connectionId,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }

    protected async prepareImpl(query: string): Promise<DuckDBPreparedStatement> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_CREATE, {
            connectionId: this.connectionId,
            query,
        });
        const result = await this.webdb['postRequest'](task) as { statementId: number };
        return new WebDuckDBPreparedStatement(this.webdb, this.connectionId, result.statementId);
    }

    protected async insertArrowIPCImpl(buffer: Uint8Array, options: DuckDBInsertOptions): Promise<void> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.INSERT_ARROW_IPC, {
            connectionId: this.connectionId,
            buffer,
            options,
        });
        await this.webdb['postRequest'](task);
    }
}

export class WebDuckDBPreparedStatement extends DuckDBPreparedStatement {
    constructor(
        protected webdb: WebDuckDB,
        protected connectionId: number,
        protected statementId: number,
    ) {
        super();
    }

    protected async closeImpl(): Promise<void> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_CLOSE, {
            connectionId: this.connectionId,
            statementId: this.statementId,
        });
        await this.webdb['postRequest'](task);
    }

    protected async runImpl(params?: any): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_RUN, {
            connectionId: this.connectionId,
            statementId: this.statementId,
            params,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }

    protected async sendImpl(params?: any): Promise<arrow.Table> {
        const task = new DuckDBWorkerTask<any, any, any>(WebDBWorkerRequestType.PREPARED_SEND, {
            connectionId: this.connectionId,
            statementId: this.statementId,
            params,
        });
        const result = await this.webdb['postRequest'](task) as { buffer: Uint8Array };
        return decodeArrowTable(result.buffer);
    }
}

export async function createDuckDB(workerUrl: string, wasmUrl: string, options?: DuckDBOpenOptions): Promise<WebDuckDB> {
    const worker = new Worker(workerUrl, { type: 'module' });
    const webdb = new WebDuckDB(worker);
    await webdb.ping();
    await webdb.instantiate(wasmUrl);
    await webdb.open(options);
    return webdb;
}
