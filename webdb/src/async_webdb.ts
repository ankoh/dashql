// Copyright (c) 2020 The DashQL Authors

import { AsyncWebDBMessageType } from './async_webdb_message';

interface Operation {
    
}

export class AsyncConnection {
    /// The database
    _webdb: AsyncWebDB;

    constructor(webdb: AsyncWebDB) {
        this._webdb = webdb;
    }
}

export class AsyncWebDB {
    /// A worker
    _worker: Worker;
    /// The message handler
    _onMessageHandler: (event: Event) => void;
    /// The error handler
    _onErrorHandler: (event: Event) => void;
    /// The close handler
    _onCloseHandler: (event: Event) => void;

    /// The operations
    _operations: Map<number, Operation> = new Map();
    /// The lower bound of the operation ids
    _operationsLB: number = 0;
    /// The upper bound of the operation ids
    _operationsUB: number = 0;

    _testPromiseResolver: ((value: any) => void) | null = null;
    _testPromiseRejecter: ((value: any) => void) | null = null;

    constructor(worker: Worker) {
        this._worker = worker;
        this._onMessageHandler = this.onMessage.bind(this);
        this._onErrorHandler = this.onError.bind(this);
        this._onCloseHandler = this.onClose.bind(this);
        this._worker.addEventListener("message", this._onMessageHandler);
        this._worker.addEventListener("error", this._onErrorHandler);
        this._worker.addEventListener("close", this._onCloseHandler);
    }

    protected onMessage(event: Event) {
        if (this._testPromiseResolver) {
            this._testPromiseRejecter = null;
            this._testPromiseResolver(event);
        }
    }

    protected onError(event: Event) {
        if (this._testPromiseRejecter) {
            this._testPromiseRejecter(event);
        }
    }

    protected onClose(event: Event) {
        if (this._testPromiseRejecter) {
            this._testPromiseRejecter(event);
        }
    }

    public async ping() {
        const promise = new Promise((resolve: (value: any) => void, reject: (reason?: void) => void) => {
            this._testPromiseResolver = resolve;
            this._testPromiseRejecter = reject;
        });
        this._worker.postMessage({
            id: 0,
            type: AsyncWebDBMessageType.PING,
            data: null,
        });
        await promise;
    }

    /// Connect to the database
    public connect(): AsyncConnection {

        return new AsyncConnection(this);
    }
}
