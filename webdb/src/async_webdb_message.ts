import { webdb as proto } from '@dashql/proto';

export enum AsyncWebDBRequestType {
    PING = 'PING',
    CONNECT = 'CONNECT',
    DISCONNECT = 'DISCONNECT',
    RUN_QUERY = 'RUN_QUERY',
    SEND_QUERY = 'SEND_QUERY',
    FETCH_QUERY_RESULTS = 'FETCH_QUERY_RESULTS',
}

export enum AsyncWebDBResponseType {
    OK = 'OK',
    ERROR = 'ERROR',
    PONG = 'PONG',
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
    | AsyncWebDBRequest<AsyncWebDBRequestType.PING, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.CONNECT, null>
    | AsyncWebDBRequest<AsyncWebDBRequestType.DISCONNECT, number>
    | AsyncWebDBRequest<AsyncWebDBRequestType.RUN_QUERY, [number, string]>
    | AsyncWebDBRequest<AsyncWebDBRequestType.SEND_QUERY, [number, string]>
    | AsyncWebDBRequest<AsyncWebDBRequestType.FETCH_QUERY_RESULTS, number>;

export type AsyncWebDBResponseVariant =
    | AsyncWebDBResponse<AsyncWebDBResponseType.OK, null>
    | AsyncWebDBResponse<AsyncWebDBResponseType.ERROR, any>
    | AsyncWebDBResponse<AsyncWebDBResponseType.CONNECTION_INFO, number>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_RESULT, proto.QueryResult>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_RESULT_CHUNK, proto.QueryResultChunk>
    | AsyncWebDBResponse<AsyncWebDBResponseType.QUERY_PLAN, proto.QueryPlan>;
