// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import { flatbuffers } from 'flatbuffers';
import {
    AsyncWebDBRequestType,
    AsyncWebDBResponseType,
    AsyncWebDBResponseVariant,
} from './async_webdb_message';

class Task<T, D, P> {
    readonly type: T;
    readonly data: D;
    promise: Promise<P>;
    promiseResolver: (value?: P) => void = () => {};
    promiseRejecter: (value: any) => void = () => {};

    constructor(type: T, data: D) {
        this.type = type;
        this.data = data;
        this.promise = new Promise<P>((resolve: (value?: P) => void, reject: (reason?: void) => void) => {
            this.promiseResolver = resolve;
            this.promiseRejecter = reject;
        });
    }
}

type ConnectionID = number;

type TaskVariant =
    | Task<AsyncWebDBRequestType.PING, null, null>
    | Task<AsyncWebDBRequestType.OPEN, string | null, null>
    | Task<AsyncWebDBRequestType.CONNECT, null, ConnectionID>
    | Task<AsyncWebDBRequestType.DISCONNECT, ConnectionID, null>
    | Task<AsyncWebDBRequestType.SEND_QUERY, [ConnectionID, string], Uint8Array>
    | Task<AsyncWebDBRequestType.RUN_QUERY, [ConnectionID, string], Uint8Array>
    | Task<AsyncWebDBRequestType.FETCH_QUERY_RESULTS, ConnectionID, Uint8Array>;

export class AsyncWebDB {
    /// The message handler
    _onMessageHandler: (event: MessageEvent) => void;
    /// The error handler
    _onErrorHandler: (event: ErrorEvent) => void;
    /// The close handler
    _onCloseHandler: () => void;

    /// A worker
    _worker: Worker | null = null;
    /// A promise for the worker shutdown
    _workerShutdownPromise: Promise<null> | null = null;
    /// Make the worker as terminated
    _workerShutdownResolver: () => void = () => {};

    /// The next message id
    _nextMessageId: number = 0;
    /// The pending requests
    _pendingRequests: Map<number, TaskVariant> = new Map();

    constructor(worker: Worker) {
        this._onMessageHandler = this.onMessage.bind(this);
        this._onErrorHandler = this.onError.bind(this);
        this._onCloseHandler = this.onClose.bind(this);
        this.attach(worker);
    }

    /// Attach to worker
    protected attach(worker: Worker) {
        this._worker = worker;
        this._worker.addEventListener('message', this._onMessageHandler);
        this._worker.addEventListener('error', this._onErrorHandler);
        this._worker.addEventListener('close', this._onCloseHandler);
        this._workerShutdownPromise = new Promise<null>(
            (resolve: (value?: null) => void, _reject: (reason?: void) => void) => {
                this._workerShutdownResolver = resolve;
            },
        );
    }

    /// Detach from worker
    public detach() {
        if (!this._worker) return;
        this._worker.removeEventListener('message', this._onMessageHandler);
        this._worker.removeEventListener('error', this._onErrorHandler);
        this._worker.removeEventListener('close', this._onCloseHandler);
        this._worker = null;
        this._workerShutdownResolver();
        this._workerShutdownPromise = null;
        this._workerShutdownResolver = () => {};
    }

    /// Wait until worker is dead
    public async terminate() {
        if (!this._worker) return;
        this._worker.terminate();
        await this._workerShutdownPromise;
        this._worker = null;
        this._workerShutdownPromise = null;
        this._workerShutdownResolver = () => {};
    }

    /// Post a task
    protected async postTask(task: TaskVariant): Promise<any> {
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

    /// Received a message
    protected onMessage(event: MessageEvent) {
        const response = event.data as AsyncWebDBResponseVariant;
        const task = this._pendingRequests.get(response.requestId);
        if (!task) {
            console.warn(`unassociated response: [${response.requestId}, ${response.type.toString()}]`);
            return;
        }
        this._pendingRequests.delete(response.requestId);

        // Request failed?
        if (response.type == AsyncWebDBResponseType.ERROR) {
            task.promiseRejecter(response.data);
            return;
        }

        // Otherwise differentiate between the tasks first
        switch (task.type) {
            case AsyncWebDBRequestType.PING:
            case AsyncWebDBRequestType.OPEN:
            case AsyncWebDBRequestType.DISCONNECT:
                if (response.type == AsyncWebDBResponseType.OK) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case AsyncWebDBRequestType.CONNECT:
                if (response.type == AsyncWebDBResponseType.CONNECTION_INFO) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case AsyncWebDBRequestType.RUN_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case AsyncWebDBRequestType.SEND_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case AsyncWebDBRequestType.FETCH_QUERY_RESULTS:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT_CHUNK) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
        }
        task.promiseRejecter(new Error('unexpected response type: ' + response.type.toString()));
    }

    /// Received an error
    protected onError(event: ErrorEvent) {
        console.error('error in webdb worker: ' + event.message);
        this._pendingRequests.clear();
    }

    /// The worker was closed
    protected onClose() {
        this._workerShutdownResolver();
        if (this._pendingRequests.size != 0) {
            console.warn(`worker terminated with ${this._pendingRequests.size} pending requests`);
            return;
        }
        this._pendingRequests.clear();
    }

    /// Ping the worker thread
    public async ping() {
        const task = new Task<AsyncWebDBRequestType.PING, null, null>(AsyncWebDBRequestType.PING, null);
        await this.postTask(task);
    }

    /// Open the database
    public async open(wasm: string | null): Promise<null> {
        const task = new Task<AsyncWebDBRequestType.OPEN, string | null, null>(AsyncWebDBRequestType.OPEN, wasm);
        return await this.postTask(task);
    }

    /// Connect to the database
    public async connect(): Promise<AsyncWebDBConnection> {
        const task = new Task<AsyncWebDBRequestType.CONNECT, null, ConnectionID>(AsyncWebDBRequestType.CONNECT, null);
        const conn = await this.postTask(task);
        return new AsyncWebDBConnection(this, conn);
    }

    /// Connect to the database
    public async disconnect(conn: ConnectionID): Promise<null> {
        const task = new Task<AsyncWebDBRequestType.DISCONNECT, ConnectionID, null>(
            AsyncWebDBRequestType.DISCONNECT,
            conn,
        );
        return await this.postTask(task);
    }

    /// Run a query
    public async runQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<AsyncWebDBRequestType.RUN_QUERY, [ConnectionID, string], Uint8Array>(
            AsyncWebDBRequestType.RUN_QUERY,
            [conn, text],
        );
        const mem = await this.postTask(task);
        const bb = new flatbuffers.ByteBuffer(mem);
        return proto.QueryResult.getRoot(bb);
    }

    /// Send a query
    public async sendQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<AsyncWebDBRequestType.SEND_QUERY, [ConnectionID, string], Uint8Array>(
            AsyncWebDBRequestType.SEND_QUERY,
            [conn, text],
        );
        const mem = await this.postTask(task);
        const bb = new flatbuffers.ByteBuffer(mem);
        return proto.QueryResult.getRoot(bb);
    }

    /// Fetch query results
    public async fetchQueryResults(conn: ConnectionID): Promise<proto.QueryResultChunk> {
        const task = new Task<AsyncWebDBRequestType.FETCH_QUERY_RESULTS, ConnectionID, Uint8Array>(
            AsyncWebDBRequestType.FETCH_QUERY_RESULTS,
            conn,
        );
        const mem = await this.postTask(task);
        const bb = new flatbuffers.ByteBuffer(mem);
        return proto.QueryResultChunk.getRoot(bb);
    }
}

/// A thin helper to memoize the connection id
export class AsyncWebDBConnection {
    /// The async webdb
    _instance: AsyncWebDB;
    /// The conn handle
    _conn: number;

    /// Constructor
    constructor(instance: AsyncWebDB, conn: number) {
        this._instance = instance;
        this._conn = conn;
    }

    public async disconnect(): Promise<null> {
        return this._instance.disconnect(this._conn);
    }

    public async runQuery(text: string): Promise<proto.QueryResult> {
        return this._instance.runQuery(this._conn, text);
    }

    public async sendQuery(text: string): Promise<proto.QueryResult> {
        return this._instance.sendQuery(this._conn, text);
    }

    public async fetchQueryResults(): Promise<proto.QueryResultChunk> {
        return this._instance.fetchQueryResults(this._conn);
    }
}
