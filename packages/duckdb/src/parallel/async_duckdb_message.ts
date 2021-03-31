import { QueryRunOptions, LogEntryVariant } from '../common';

export enum AsyncDuckDBRequestType {
    RESET = 'RESET',
    PING = 'PING',
    REGISTER_URL = 'REGISTER_URL',
    UNREGISTER_URL = 'UNREGISTER_URL',
    OPEN_URL = 'OPEN_URL',
    IMPORT_JSON = 'IMPORT_JSON',
    IMPORT_CSV = 'IMPORT_CSV',
    IMPORT_PARQUET = 'IMPORT_PARQUET',
    OPEN = 'OPEN',
    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',
    RUN_QUERY = 'RUN_QUERY',
    SEND_QUERY = 'SEND_QUERY',
    FETCH_QUERY_RESULTS = 'FETCH_QUERY_RESULTS',
}

export enum AsyncDuckDBResponseType {
    LOG = 'LOG',
    OK = 'OK',
    ERROR = 'ERROR',
    BLOB_ID = 'BLOB_ID',
    CONNECTION_INFO = 'CONNECTION_INFO',
    QUERY_RESULT = 'QUERY_RESULT',
    QUERY_RESULT_CHUNK = 'QUERY_RESULT_CHUNK',
    QUERY_PLAN = 'QUERY_PLAN',
}

export type AsyncDuckDBRequest<T, P> = {
    readonly messageId: number;
    readonly type: T;
    readonly data: P;
};

export type AsyncDuckDBResponse<T, P> = {
    readonly messageId: number;
    readonly requestId: number;
    readonly type: T;
    readonly data: P;
};

export type AsyncDuckDBRequestVariant =
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.RESET, null>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.PING, null>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.REGISTER_URL, string>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.UNREGISTER_URL, string>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.OPEN_URL, string>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.IMPORT_JSON, [number, string, string, string]>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.IMPORT_CSV, [number, string, string, string]>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.IMPORT_PARQUET, [number, string, string, string]>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.OPEN, string>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.CONNECT, null>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.DISCONNECT, number>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.RUN_QUERY, [number, string, QueryRunOptions]>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.SEND_QUERY, [number, string, QueryRunOptions]>
    | AsyncDuckDBRequest<AsyncDuckDBRequestType.FETCH_QUERY_RESULTS, number>;

export type AsyncDuckDBResponseVariant =
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.LOG, LogEntryVariant>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.OK, null>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.ERROR, any>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.BLOB_ID, number>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.CONNECTION_INFO, number>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.QUERY_RESULT, Uint8Array>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.QUERY_RESULT_CHUNK, Uint8Array>
    | AsyncDuckDBResponse<AsyncDuckDBResponseType.QUERY_PLAN, Uint8Array>;
