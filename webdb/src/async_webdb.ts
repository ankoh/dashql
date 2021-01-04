// Copyright (c) 2020 The DashQL Authors

import { webdb as proto } from '@dashql/proto';
import {
    AsyncWebDBRequestType,
    AsyncWebDBResponseType,
    AsyncWebDBRequestVariant,
    AsyncWebDBResponseVariant,
} from './async_webdb_message';

enum TaskType {
    PING = 'PING',
    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',
    RUN_QUERY = 'RUN_QUERY',
    SEND_QUERY = 'SEND_QUERY',
    FETCH_QUERY_RESULTS = 'FETCH_QUERY_RESULTS',
}

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
    | Task<TaskType.PING, null, null>
    | Task<TaskType.CONNECT, null, ConnectionID>
    | Task<TaskType.DISCONNECT, ConnectionID, null>
    | Task<TaskType.SEND_QUERY, [ConnectionID, string], proto.QueryResult>
    | Task<TaskType.RUN_QUERY, [ConnectionID, string], proto.QueryResult>
    | Task<TaskType.FETCH_QUERY_RESULTS, ConnectionID, proto.QueryResultChunk>;

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
        const mid = this._nextMessageId++;
        this._pendingRequests.set(mid, task);
        switch (task.type) {
            case TaskType.PING:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.PING,
                    data: null,
                });
                break;
            case TaskType.CONNECT:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.CONNECT,
                    data: task.data,
                });
                break;
            case TaskType.DISCONNECT:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.DISCONNECT,
                    data: task.data,
                });
                break;
            case TaskType.RUN_QUERY:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.RUN_QUERY,
                    data: task.data,
                });
                break;
            case TaskType.SEND_QUERY:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.SEND_QUERY,
                    data: task.data,
                });
                break;
            case TaskType.FETCH_QUERY_RESULTS:
                this.postRequest({
                    messageId: mid,
                    type: AsyncWebDBRequestType.FETCH_QUERY_RESULTS,
                    data: task.data,
                });
                break;
        }
        return await task.promise;
    }

    /// Thin wrapper around post message for strong typing of requests
    protected postRequest(request: AsyncWebDBRequestVariant) {
        if (!this._worker) {
            console.error('cannot send a message since the worker is not set!');
            return;
        }
        this._worker.postMessage(request);
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
        switch (task.type) {
            case TaskType.RUN_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case TaskType.SEND_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    task.promiseResolver(response.data);
                    return;
                }
                break;
            case TaskType.PING:
                if (response.type == AsyncWebDBResponseType.PONG) {
                    task.promiseResolver(null);
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
        const task = new Task<TaskType.PING, null, null>(TaskType.PING, null);
        await this.postTask(task);
    }

    /// Connect to the database
    public async connect(): Promise<AsyncWebDBConnection> {
        const task = new Task<TaskType.CONNECT, null, ConnectionID>(TaskType.CONNECT, null);
        const conn = await this.postTask(task);
        return new AsyncWebDBConnection(this, conn);
    }

    /// Connect to the database
    public async disconnect(conn: ConnectionID): Promise<null> {
        const task = new Task<TaskType.DISCONNECT, ConnectionID, null>(TaskType.DISCONNECT, conn);
        return await this.postTask(task);
    }

    /// Run a query
    public async runQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<TaskType.RUN_QUERY, [ConnectionID, string], proto.QueryResult>(TaskType.RUN_QUERY, [
            conn,
            text,
        ]);
        return await this.postTask(task);
    }

    /// Send a query
    public async sendQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<TaskType.SEND_QUERY, [ConnectionID, string], proto.QueryResult>(TaskType.SEND_QUERY, [
            conn,
            text,
        ]);
        return await this.postTask(task);
    }

    /// Fetch query results
    public async fetchQueryResults(conn: ConnectionID): Promise<proto.QueryResultChunk> {
        const task = new Task<TaskType.FETCH_QUERY_RESULTS, ConnectionID, proto.QueryResultChunk>(
            TaskType.FETCH_QUERY_RESULTS,
            conn,
        );
        return await this.postTask(task);
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
