export enum AsyncWebDBMessageType {
    PING = 'PING',
    PONG = 'PONG',
    RUN_QUERY_COMMAND = 'RUN_QUERY_COMMAND',
    SEND_QUERY_COMMAND = 'SEND_QUERY_COMMAND',
    FETCH_QUERY_RESULTS_COMMAND = 'FETCH_QUERY_RESULTS_COMMAND',
}

export type AsyncWebDBMessage<T, P> = {
    readonly id: number;
    readonly type: T;
    readonly data: P;
};

export type AsyncWebDBRequest =
    | AsyncWebDBMessage<AsyncWebDBMessageType.PING, null>
    | AsyncWebDBMessage<AsyncWebDBMessageType.RUN_QUERY_COMMAND, string>
    | AsyncWebDBMessage<AsyncWebDBMessageType.SEND_QUERY_COMMAND, string>
    | AsyncWebDBMessage<AsyncWebDBMessageType.FETCH_QUERY_RESULTS_COMMAND, string>
    ;

export type AsyncWebDBResponse =
    | AsyncWebDBMessage<AsyncWebDBMessageType.PONG, null>;
