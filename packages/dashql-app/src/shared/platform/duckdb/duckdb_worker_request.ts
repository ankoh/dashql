import { DuckDBInsertOptions, DuckDBOpenOptions } from './duckdb_api.js';

export type WebDBOpenOptions = DuckDBOpenOptions;
export type WebDBInsertOptions = DuckDBInsertOptions;

export enum WebDBWorkerRequestType {
    PING = 'PING',
    INSTANTIATE = 'INSTANTIATE',
    OPEN = 'OPEN',
    RESET = 'RESET',
    GET_VERSION = 'GET_VERSION',

    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',

    QUERY_RUN = 'QUERY_RUN',
    QUERY_PENDING_START = 'QUERY_PENDING_START',
    QUERY_PENDING_POLL = 'QUERY_PENDING_POLL',
    QUERY_PENDING_CANCEL = 'QUERY_PENDING_CANCEL',
    QUERY_FETCH_RESULTS = 'QUERY_FETCH_RESULTS',

    PREPARED_CREATE = 'PREPARED_CREATE',
    PREPARED_RUN = 'PREPARED_RUN',
    PREPARED_SEND = 'PREPARED_SEND',
    PREPARED_CLOSE = 'PREPARED_CLOSE',

    INSERT_ARROW_IPC = 'INSERT_ARROW_IPC',
}

export enum WebDBWorkerResponseType {
    OK = 'OK',
    ERROR = 'ERROR',

    VERSION = 'VERSION',
    CONNECTION_ID = 'CONNECTION_ID',
    ARROW_BUFFER = 'ARROW_BUFFER',
    PREPARED_STATEMENT_ID = 'PREPARED_STATEMENT_ID',

    QUERY_RESULT_CHUNK = 'QUERY_RESULT_CHUNK',
    QUERY_RESULT_COMPLETE = 'QUERY_RESULT_COMPLETE',
}

export type WebDBWorkerRequest<T, P> = {
    readonly messageId: number;
    readonly type: T;
    readonly data: P;
};

export type WebDBWorkerResponse<T, P> = {
    readonly messageId: number;
    readonly requestId: number;
    readonly type: T;
    readonly data: P;
};

export type WebDBWorkerRequestVariant =
    | WebDBWorkerRequest<WebDBWorkerRequestType.PING, null>
    | WebDBWorkerRequest<WebDBWorkerRequestType.INSTANTIATE, { wasmUrl: string }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.OPEN, WebDBOpenOptions>
    | WebDBWorkerRequest<WebDBWorkerRequestType.RESET, null>
    | WebDBWorkerRequest<WebDBWorkerRequestType.GET_VERSION, null>

    | WebDBWorkerRequest<WebDBWorkerRequestType.CONNECT, null>
    | WebDBWorkerRequest<WebDBWorkerRequestType.DISCONNECT, { connectionId: number }>

    | WebDBWorkerRequest<WebDBWorkerRequestType.QUERY_RUN, { connectionId: number; query: string }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.QUERY_PENDING_START, { connectionId: number; query: string; allowStreamResult: boolean }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.QUERY_PENDING_POLL, { connectionId: number }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.QUERY_PENDING_CANCEL, { connectionId: number }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.QUERY_FETCH_RESULTS, { connectionId: number }>

    | WebDBWorkerRequest<WebDBWorkerRequestType.PREPARED_CREATE, { connectionId: number; query: string }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.PREPARED_RUN, { connectionId: number; statementId: number; params?: any }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.PREPARED_SEND, { connectionId: number; statementId: number; params?: any }>
    | WebDBWorkerRequest<WebDBWorkerRequestType.PREPARED_CLOSE, { connectionId: number; statementId: number }>

    | WebDBWorkerRequest<WebDBWorkerRequestType.INSERT_ARROW_IPC, { connectionId: number; buffer: Uint8Array; options: WebDBInsertOptions }>
    ;

export type WebDBWorkerResponseVariant =
    | WebDBWorkerResponse<WebDBWorkerResponseType.OK, null>
    | WebDBWorkerResponse<WebDBWorkerResponseType.ERROR, any>
    | WebDBWorkerResponse<WebDBWorkerResponseType.VERSION, { version: string }>
    | WebDBWorkerResponse<WebDBWorkerResponseType.CONNECTION_ID, { connectionId: number }>
    | WebDBWorkerResponse<WebDBWorkerResponseType.ARROW_BUFFER, { buffer: Uint8Array }>
    | WebDBWorkerResponse<WebDBWorkerResponseType.PREPARED_STATEMENT_ID, { statementId: number }>
    | WebDBWorkerResponse<WebDBWorkerResponseType.QUERY_RESULT_CHUNK, { buffer: Uint8Array }>
    | WebDBWorkerResponse<WebDBWorkerResponseType.QUERY_RESULT_COMPLETE, null>
    ;

export class DuckDBWorkerTask<T extends WebDBWorkerRequestType, D, P> {
    readonly type: T;
    readonly data: D;
    promise: Promise<P>;
    promiseResolver: (value: P | PromiseLike<P>) => void = () => { };
    promiseRejecter: (value: any) => void = () => { };

    constructor(type: T, data: D) {
        this.type = type;
        this.data = data;
        this.promise = new Promise<P>(
            (resolve: (value: P | PromiseLike<P>) => void, reject: (reason?: any) => void) => {
                this.promiseResolver = resolve;
                this.promiseRejecter = reject;
            },
        );
    }
}

export type DuckDBWorkerTaskVariant =
    | DuckDBWorkerTask<WebDBWorkerRequestType.PING, null, null>
    | DuckDBWorkerTask<WebDBWorkerRequestType.INSTANTIATE, { wasmUrl: string }, null>
    | DuckDBWorkerTask<WebDBWorkerRequestType.OPEN, WebDBOpenOptions, null>
    | DuckDBWorkerTask<WebDBWorkerRequestType.RESET, null, null>
    | DuckDBWorkerTask<WebDBWorkerRequestType.GET_VERSION, null, { version: string }>

    | DuckDBWorkerTask<WebDBWorkerRequestType.CONNECT, null, { connectionId: number }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.DISCONNECT, { connectionId: number }, null>

    | DuckDBWorkerTask<WebDBWorkerRequestType.QUERY_RUN, { connectionId: number; query: string }, { buffer: Uint8Array }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.QUERY_PENDING_START, { connectionId: number; query: string; allowStreamResult: boolean }, { buffer: Uint8Array }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.QUERY_PENDING_POLL, { connectionId: number }, { buffer: Uint8Array }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.QUERY_PENDING_CANCEL, { connectionId: number }, null>
    | DuckDBWorkerTask<WebDBWorkerRequestType.QUERY_FETCH_RESULTS, { connectionId: number }, { buffer: Uint8Array }>

    | DuckDBWorkerTask<WebDBWorkerRequestType.PREPARED_CREATE, { connectionId: number; query: string }, { statementId: number }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.PREPARED_RUN, { connectionId: number; statementId: number; params?: any }, { buffer: Uint8Array }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.PREPARED_SEND, { connectionId: number; statementId: number; params?: any }, { buffer: Uint8Array }>
    | DuckDBWorkerTask<WebDBWorkerRequestType.PREPARED_CLOSE, { connectionId: number; statementId: number }, null>

    | DuckDBWorkerTask<WebDBWorkerRequestType.INSERT_ARROW_IPC, { connectionId: number; buffer: Uint8Array; options: WebDBInsertOptions }, null>
    ;

export type DuckDBWorkerTaskReturnType<T extends DuckDBWorkerTaskVariant> =
    T extends DuckDBWorkerTask<any, any, infer P> ? P : never;
