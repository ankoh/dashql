import { LogEntryVariant } from './log';
import { QueryRunOptions } from './query_options';
import { BlobStream } from './webdb_bindings';

export enum AsyncWebDBRequestType {
    RESET = 'RESET',
    PING = 'PING',
    INGEST_BLOBSTREAM = 'INGEST_BLOBSTREAM',
    IMPORT_CSV = 'IMPORT_CSV',
    FS_TEST = 'FS_TEST',
    OPEN = 'OPEN',
    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',
    RUN_QUERY = 'RUN_QUERY',
    SEND_QUERY = 'SEND_QUERY',
    FETCH_QUERY_RESULTS = 'FETCH_QUERY_RESULTS',
}

export enum AsyncWebDBResponseType {
    LOG = 'LOG',
    OK = 'OK',
    ERROR = 'ERROR',
    CONNECTION_INFO = 'CONNECTION_INFO',
    QUERY_RESULT = 'QUERY_RESULT',
    QUERY_RESULT_CHUNK = 'QUERY_RESULT_CHUNK',
    QUERY_PLAN = 'QUERY_PLAN',
}

export type AsyncWebDBRequest<T, P> = {
    readonly messageId: number;
    readonly type: T;
    readonly data: P;
};

export type AsyncWebDBResponse<T, P> = {
    readonly messageId: number;
    readonly requestId: number;
    readonly type: T;
    readonly data: P;
};

export type AsyncWebDBRequestVariant =
    | AsyncWebDBRequest<AsyncWebDBRequestType.RESET, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.PING, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.FS_TEST, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.INGEST_BLOBSTREAM, BlobStream>
    | AsyncWebDBRequest<AsyncWebDBRequestType.IMPORT_CSV, [number, BlobStream, string, string]>
    | AsyncWebDBRequest<AsyncWebDBRequestType.OPEN, string>
    | AsyncWebDBRequest<AsyncWebDBRequestType.CONNECT, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.DISCONNECT, number>
    | AsyncWebDBRequest<AsyncWebDBRequestType.RUN_QUERY, [number, string, QueryRunOptions]>
    | AsyncWebDBRequest<AsyncWebDBRequestType.SEND_QUERY, [number, string, QueryRunOptions]>
    | AsyncWebDBRequest<AsyncWebDBRequestType.FETCH_QUERY_RESULTS, number>;

export type AsyncWebDBResponseVariant =
    | AsyncWebDBResponse<AsyncWebDBResponseType.LOG, LogEntryVariant>
    | AsyncWebDBResponse<AsyncWebDBResponseType.OK, null>
    | AsyncWebDBResponse<AsyncWebDBResponseType.ERROR, any>
    | AsyncWebDBResponse<AsyncWebDBResponseType.CONNECTION_INFO, number>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_RESULT, Uint8Array>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_RESULT_CHUNK, Uint8Array>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_PLAN, Uint8Array>;
