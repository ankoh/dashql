// Copyright (c) 2020 The DashQL Authors

import {
    WorkerRequestType,
    WorkerResponseType,
    WorkerResponseVariant,
    WorkerTaskVariant,
    WorkerTask,
    ConnectionID,
} from './worker_request';
import { Logger } from '../log';
import { AsyncDuckDBConnection } from './async_connection';

export class AsyncDuckDB {
    /** The message handler */
    protected _onMessageHandler: (event: MessageEvent) => void;
    /** The error handler */
    protected _onErrorHandler: (event: ErrorEvent) => void;
    /** The close handler */
    protected _onCloseHandler: () => void;

    /** The logger */
    protected _logger: Logger;
    /** The worker */
    protected _worker: Worker | null = null;
    /** The promise for the worker shutdown */
    protected _workerShutdownPromise: Promise<null> | null = null;
    /** Make the worker as terminated */
    protected _workerShutdownResolver: (value: PromiseLike<null> | null) => void = () => {};

    /** The next message id */
    protected _nextMessageId: number = 0;
    /** The pending requests */
    protected _pendingRequests: Map<number, WorkerTaskVariant> = new Map();

    constructor(logger: Logger, worker: Worker | null = null) {
        this._logger = logger;
        this._onMessageHandler = this.onMessage.bind(this);
        this._onErrorHandler = this.onError.bind(this);
        this._onCloseHandler = this.onClose.bind(this);
        if (worker != null) this.attach(worker);
    }

    /** Get the logger */
    public get logger() {
        return this._logger;
    }

    /** Attach to worker */
    protected attach(worker: Worker) {
        this._worker = worker;
        this._worker.addEventListener('message', this._onMessageHandler);
        this._worker.addEventListener('error', this._onErrorHandler);
        this._worker.addEventListener('close', this._onCloseHandler);
        this._workerShutdownPromise = new Promise<null>(
            (resolve: (value: PromiseLike<null> | null) => void, _reject: (reason?: void) => void) => {
                this._workerShutdownResolver = resolve;
            },
        );
    }

    /** Detach from worker */
    public detach() {
        if (!this._worker) return;
        this._worker.removeEventListener('message', this._onMessageHandler);
        this._worker.removeEventListener('error', this._onErrorHandler);
        this._worker.removeEventListener('close', this._onCloseHandler);
        this._worker = null;
        this._workerShutdownResolver(null);
        this._workerShutdownPromise = null;
        this._workerShutdownResolver = () => {};
    }

    /** Kill the worker */
    public async terminate() {
        if (!this._worker) return;
        this._worker.terminate();
        //await this._workerShutdownPromise; TODO deadlocking in karma?
        this._worker = null;
        this._workerShutdownPromise = null;
        this._workerShutdownResolver = () => {};
    }

    /** Post a task */
    protected async postTask(task: WorkerTaskVariant): Promise<any> {
        if (!this._worker) {
            console.error('cannot send a message since the worker is not set!');
            return;
        }
        const mid = this._nextMessageId++;
        this._pendingRequests.set(mid, task);
        this._worker.postMessage({
            messageId: mid,
            type: task.type,
            data: task.data,
        });
        return await task.promise;
    }

    /** Received a message */
    protected onMessage(event: MessageEvent) {
        const response = event.data as WorkerResponseVariant;

        // Short-circuit unassociated log entries
        if (response.type == WorkerResponseType.LOG) {
            this._logger.log(response.data);
        }

        // Get associated task
        const task = this._pendingRequests.get(response.requestId);
        if (!task) {
            console.warn(`unassociated response: [${response.requestId}, ${response.type.toString()}]`);
            return;
        }
        this._pendingRequests.delete(response.requestId);

        // Request failed?
        if (response.type == WorkerResponseType.ERROR) {
            // Workaround for Firefox not being able to perform structured-clone on Native Errors
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1556604
            let e = new Error(response.data.message);
            e.name = response.data.name;
            e.stack = response.data.stack;

            task.promiseRejecter(e);
            return;
        }

        // Otherwise differentiate between the tasks first
        switch (task.type) {
            case WorkerRequestType.RESET:
            case WorkerRequestType.PING:
            case WorkerRequestType.IMPORT_CSV:
            case WorkerRequestType.REGISTER_URL:
            case WorkerRequestType.OPEN:
            case WorkerRequestType.DISCONNECT:
                if (response.type == WorkerResponseType.OK) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case WorkerRequestType.OPEN_URL:
                if (response.type == WorkerResponseType.BLOB_ID) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case WorkerRequestType.CONNECT:
                if (response.type == WorkerResponseType.CONNECTION_INFO) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case WorkerRequestType.RUN_QUERY:
                if (response.type == WorkerResponseType.QUERY_RESULT) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case WorkerRequestType.SEND_QUERY:
                if (response.type == WorkerResponseType.QUERY_START) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case WorkerRequestType.FETCH_QUERY_RESULTS:
                if (response.type == WorkerResponseType.QUERY_RESULT_CHUNK) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
        }
        task.promiseRejecter(new Error(`unexpected response type: ${response.type.toString()}`));
    }

    /** Received an error */
    protected onError(event: ErrorEvent) {
        console.error(event);
        console.error(`error in duckdb worker: ${event.message}`);
        this._pendingRequests.clear();
    }

    /** The worker was closed */
    protected onClose() {
        this._workerShutdownResolver(null);
        if (this._pendingRequests.size != 0) {
            console.warn(`worker terminated with ${this._pendingRequests.size} pending requests`);
            return;
        }
        this._pendingRequests.clear();
    }

    /** Reset the duckdb */
    public async reset(): Promise<null> {
        const task = new WorkerTask<WorkerRequestType.RESET, null, null>(WorkerRequestType.RESET, null);
        return await this.postTask(task);
    }

    /** Ping the worker thread */
    public async ping() {
        const task = new WorkerTask<WorkerRequestType.PING, null, null>(WorkerRequestType.PING, null);
        await this.postTask(task);
    }

    /// Registers the given URL as a file to be possibly loaded by DuckDB.
    public async registerURL(url: string): Promise<null> {
        const task = new WorkerTask<WorkerRequestType.REGISTER_URL, string, null>(WorkerRequestType.REGISTER_URL, url);
        return await this.postTask(task);
    }

    /// Open a file previously registered by the given URL. Returns the Blob ID
    public async openURL(url: string): Promise<number> {
        const task = new WorkerTask<WorkerRequestType.OPEN_URL, string, number>(WorkerRequestType.OPEN_URL, url);
        return await this.postTask(task);
    }

    /// Import csv from a given URL
    public async importCSV(conn: ConnectionID, filePath: string, schemaName: string, tableName: string): Promise<null> {
        const task = new WorkerTask<WorkerRequestType.IMPORT_CSV, [number, string, string, string], null>(
            WorkerRequestType.IMPORT_CSV,
            [conn, filePath, schemaName, tableName],
        );
        return await this.postTask(task);
    }

    /** Open the database */
    public async open(wasm: string | null): Promise<null> {
        const task = new WorkerTask<WorkerRequestType.OPEN, string | null, null>(WorkerRequestType.OPEN, wasm);
        return await this.postTask(task);
    }

    /** Connect to the database */
    public async connect(): Promise<AsyncDuckDBConnection> {
        const task = new WorkerTask<WorkerRequestType.CONNECT, null, ConnectionID>(WorkerRequestType.CONNECT, null);
        const conn = await this.postTask(task);
        return new AsyncDuckDBConnection(this, conn);
    }

    /** Disconnect from the database */
    public async disconnect(conn: ConnectionID): Promise<null> {
        const task = new WorkerTask<WorkerRequestType.DISCONNECT, ConnectionID, null>(
            WorkerRequestType.DISCONNECT,
            conn,
        );
        return await this.postTask(task);
    }

    /// Run a query
    public async runQuery(conn: ConnectionID, text: string): Promise<Uint8Array> {
        const task = new WorkerTask<WorkerRequestType.RUN_QUERY, [ConnectionID, string], Uint8Array>(
            WorkerRequestType.RUN_QUERY,
            [conn, text],
        );
        return await this.postTask(task);
    }

    /** Send a query */
    public async sendQuery(conn: ConnectionID, text: string): Promise<Uint8Array> {
        const task = new WorkerTask<WorkerRequestType.SEND_QUERY, [ConnectionID, string], Uint8Array>(
            WorkerRequestType.SEND_QUERY,
            [conn, text],
        );
        return await this.postTask(task);
    }

    /** Fetch query results */
    public async fetchQueryResults(conn: ConnectionID): Promise<Uint8Array> {
        const task = new WorkerTask<WorkerRequestType.FETCH_QUERY_RESULTS, ConnectionID, Uint8Array>(
            WorkerRequestType.FETCH_QUERY_RESULTS,
            conn,
        );
        return await this.postTask(task);
    }
}
