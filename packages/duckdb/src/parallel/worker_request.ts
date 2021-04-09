// Copyright (c) 2020 The DashQL Authors

import { LogEntryVariant } from '../log';

export type ConnectionID = number;

export enum WorkerRequestType {
    RESET = 'RESET',
    PING = 'PING',
    REGISTER_URL = 'REGISTER_URL',
    OPEN_URL = 'OPEN_URL',
    IMPORT_CSV = 'IMPORT_CSV',
    OPEN = 'OPEN',
    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',
    RUN_QUERY = 'RUN_QUERY',
    SEND_QUERY = 'SEND_QUERY',
    FETCH_QUERY_RESULTS = 'FETCH_QUERY_RESULTS',
}

export enum WorkerResponseType {
    LOG = 'LOG',
    OK = 'OK',
    ERROR = 'ERROR',
    BLOB_ID = 'BLOB_ID',
    CONNECTION_INFO = 'CONNECTION_INFO',
    QUERY_RESULT = 'QUERY_RESULT',
    QUERY_RESULT_CHUNK = 'QUERY_RESULT_CHUNK',
    QUERY_START = 'QUERY_START',
    QUERY_PLAN = 'QUERY_PLAN',
}

export type WorkerRequest<T, P> = {
    readonly messageId: number;
    readonly type: T;
    readonly data: P;
};

export type WorkerResponse<T, P> = {
    readonly messageId: number;
    readonly requestId: number;
    readonly type: T;
    readonly data: P;
};

export class WorkerTask<T, D, P> {
    readonly type: T;
    readonly data: D;
    promise: Promise<P>;
    promiseResolver: (value: P | PromiseLike<P>) => void = () => {};
    promiseRejecter: (value: any) => void = () => {};

    constructor(type: T, data: D) {
        this.type = type;
        this.data = data;
        this.promise = new Promise<P>(
            (resolve: (value: P | PromiseLike<P>) => void, reject: (reason?: void) => void) => {
                this.promiseResolver = resolve;
                this.promiseRejecter = reject;
            },
        );
    }
}

export type WorkerRequestVariant =
    | WorkerRequest<WorkerRequestType.RESET, null>
    | WorkerRequest<WorkerRequestType.PING, null>
    | WorkerRequest<WorkerRequestType.REGISTER_URL, string>
    | WorkerRequest<WorkerRequestType.OPEN_URL, string>
    | WorkerRequest<WorkerRequestType.IMPORT_CSV, [number, string, string, string]>
    | WorkerRequest<WorkerRequestType.OPEN, string>
    | WorkerRequest<WorkerRequestType.CONNECT, null>
    | WorkerRequest<WorkerRequestType.DISCONNECT, number>
    | WorkerRequest<WorkerRequestType.RUN_QUERY, [number, string]>
    | WorkerRequest<WorkerRequestType.SEND_QUERY, [number, string]>
    | WorkerRequest<WorkerRequestType.FETCH_QUERY_RESULTS, number>;

export type WorkerResponseVariant =
    | WorkerResponse<WorkerResponseType.LOG, LogEntryVariant>
    | WorkerResponse<WorkerResponseType.OK, null>
    | WorkerResponse<WorkerResponseType.ERROR, any>
    | WorkerResponse<WorkerResponseType.BLOB_ID, number>
    | WorkerResponse<WorkerResponseType.CONNECTION_INFO, number>
    | WorkerResponse<WorkerResponseType.QUERY_RESULT, Uint8Array>
    | WorkerResponse<WorkerResponseType.QUERY_RESULT_CHUNK, Uint8Array>
    | WorkerResponse<WorkerResponseType.QUERY_START, Uint8Array>
    | WorkerResponse<WorkerResponseType.QUERY_PLAN, Uint8Array>;

export type WorkerTaskVariant =
    | WorkerTask<WorkerRequestType.RESET, null, null>
    | WorkerTask<WorkerRequestType.IMPORT_CSV, [number, string, string, string], null>
    | WorkerTask<WorkerRequestType.PING, null, null>
    | WorkerTask<WorkerRequestType.REGISTER_URL, string, null>
    | WorkerTask<WorkerRequestType.OPEN_URL, string, number>
    | WorkerTask<WorkerRequestType.OPEN, string | null, null>
    | WorkerTask<WorkerRequestType.CONNECT, null, ConnectionID>
    | WorkerTask<WorkerRequestType.DISCONNECT, ConnectionID, null>
    | WorkerTask<WorkerRequestType.SEND_QUERY, [ConnectionID, string], Uint8Array>
    | WorkerTask<WorkerRequestType.RUN_QUERY, [ConnectionID, string], Uint8Array>
    | WorkerTask<WorkerRequestType.FETCH_QUERY_RESULTS, ConnectionID, Uint8Array>;
