import { LogEntryVariant } from '../log';

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
    | WorkerResponse<WorkerResponseType.QUERY_PLAN, Uint8Array>;
