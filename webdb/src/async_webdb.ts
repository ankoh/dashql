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
    readonly id: number;
    readonly type: T;
    readonly data: D;
    promise: Promise<P>;
    promiseResolver: (value?: P) => void = () => {};
    promiseRejecter: (value: any) => void = () => {};

    /// Constructor
    constructor(id: number, type: T, data: D) {
        this.id = id;
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

class Queue<T> {
    _values: T[] = [];
    empty() {
        return this._values.length == 0;
    }
    push(val: T) {
        this._values.push(val);
    }
    pop(): T | null {
        return this._values.shift() || null;
    }
}

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

    /// The next task id
    _nextTaskId: number = 0;
    /// The next message id
    _nextMessageId: number = 0;
    /// The queue
    _queue: Queue<TaskVariant> = new Queue();
    /// The active task
    _activeTask: TaskVariant | null = null;

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
        this._workerShutdownPromise = new Promise<null>((resolve: (value?: null) => void, _reject: (reason?: void) => void) => {
            this._workerShutdownResolver = resolve;
        });
    }

    /// Detach from worker
    public detach() {
        if (!this._worker) {
            return;
        }
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
        if (!this._worker) {
            return;
        }
        this._worker.terminate();
        await this._workerShutdownPromise;
        this._worker = null;
        this._workerShutdownPromise = null;
        this._workerShutdownResolver = () => {};
    }

    /// Post a task
    protected postTask(task: TaskVariant): Promise<any> {
        if (this._activeTask != null) {
            this._queue.push(task);
            return task.promise;
        }
        this.processTask(task);
        return task.promise;
    }

    /// Process a new task
    protected startNextTask() {
        this._activeTask = null;
        if (this._queue.empty()) {
            return;
        }
        this.processTask(this._queue.pop()!);
    }

    /// Thin wrapper around post message for strong typing of message
    protected postMessage(message: AsyncWebDBRequestVariant) {
        if (!this._worker) {
            console.error('cannot send a message since the worker is not set!');
            return;
        }
        this._worker.postMessage(message);
    }

    /// Process a new task
    protected processTask(task: TaskVariant) {
        this._activeTask = task;
        switch (task.type) {
            case TaskType.PING:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.PING,
                    data: null,
                });
                break;
            case TaskType.CONNECT:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.CONNECT,
                    data: task.data,
                });
                break;
            case TaskType.DISCONNECT:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.DISCONNECT,
                    data: task.data,
                });
                break;
            case TaskType.RUN_QUERY:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.RUN_QUERY,
                    data: task.data,
                });
                break;
            case TaskType.SEND_QUERY:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.SEND_QUERY,
                    data: task.data,
                });
                break;
            case TaskType.FETCH_QUERY_RESULTS:
                this.postMessage({
                    messageId: this._nextMessageId,
                    type: AsyncWebDBRequestType.FETCH_QUERY_RESULTS,
                    data: task.data,
                });
                break;
        }
    }

    /// Received a message
    protected onMessage(event: MessageEvent) {
        const response = event.data as AsyncWebDBResponseVariant;

        // There must be an active task
        if (!this._activeTask) {
            console.warn('unexpected task message:' + response.type.toString());
            return;
        }
        switch (this._activeTask.type) {
            case TaskType.RUN_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    this._activeTask!.promiseResolver(response.data);
                    this.startNextTask();
                    return;
                }
                break;
            case TaskType.SEND_QUERY:
                if (response.type == AsyncWebDBResponseType.QUERY_RESULT) {
                    this._activeTask!.promiseResolver(response.data);
                    // User still has to fetch data, so keep the task active
                    return;
                }
                break;
            case TaskType.PING:
                if (response.type == AsyncWebDBResponseType.PONG) {
                    this._activeTask!.promiseResolver(null);
                    this.startNextTask();
                    return;
                }
                break;
        }
        this._activeTask!.promiseRejecter(new Error('unexpected response type: ' + response.type.toString()));
        this._activeTask = null;
    }

    /// Received an error
    protected onError(event: ErrorEvent) {
        if (!this._activeTask) {
            console.error('error in webdb worker: ' + event.message);
            return;
        }
        this._activeTask!.promiseRejecter(event.error);
        this._activeTask = null;
    }

    /// The worker was closed
    protected onClose() {
        this._workerShutdownResolver();
        if (this._activeTask != null) {
            console.warn('terminate worker with active task of type ' + this._activeTask.type.toString());
            return;
        }
        this._activeTask = null;
    }

    /// Ping the worker thread
    public async ping() {
        const task = new Task<TaskType.PING, null, null>(this._nextTaskId++, TaskType.PING, null);
        await this.postTask(task);
    }

    /// Connect to the database
    public async connect(): Promise<AsyncWebDBConnection> {
        const task = new Task<TaskType.CONNECT, null, ConnectionID>(this._nextTaskId++, TaskType.CONNECT, null);
        const conn = await this.postTask(task);
        return new AsyncWebDBConnection(this, conn);
    }

    /// Connect to the database
    public async disconnect(conn: ConnectionID): Promise<null> {
        const task = new Task<TaskType.DISCONNECT, ConnectionID, null>(this._nextTaskId++, TaskType.DISCONNECT, conn);
        return await this.postTask(task);
    }

    /// Run a query
    public async runQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<TaskType.RUN_QUERY, [ConnectionID, string], proto.QueryResult>(
            this._nextTaskId++,
            TaskType.RUN_QUERY,
            [conn, text],
        );
        return await this.postTask(task);
    }

    /// Send a query
    public async sendQuery(conn: ConnectionID, text: string): Promise<proto.QueryResult> {
        const task = new Task<TaskType.SEND_QUERY, [ConnectionID, string], proto.QueryResult>(
            this._nextTaskId++,
            TaskType.SEND_QUERY,
            [conn, text],
        );
        return await this.postTask(task);
    }

    /// Fetch query results
    public async fetchQueryResults(conn: ConnectionID): Promise<proto.QueryResultChunk> {
        const task = new Task<TaskType.FETCH_QUERY_RESULTS, ConnectionID, proto.QueryResultChunk>(
            this._nextTaskId++,
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
