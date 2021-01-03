
export enum WAPIMessageType {
    PING = 'PING',
    PONG = 'PONG',
    RUN_QUERY_COMMAND = 'RUN_QUERY_COMMAND',
    SEND_QUERY_COMMAND = 'SEND_QUERY_COMMAND',
    FETCH_QUERY_RESULTS_COMMAND = 'FETCH_QUERY_RESULTS_COMMAND',
}

export type WAPIMessage<T, P> = {
    readonly type: T;
    readonly data: P;
};

export type WAPIRequest =
    | WAPIMessage<WAPIMessageType.PING, null>
    | WAPIMessage<WAPIMessageType.RUN_QUERY_COMMAND, string>
    | WAPIMessage<WAPIMessageType.SEND_QUERY_COMMAND, string>
    | WAPIMessage<WAPIMessageType.FETCH_QUERY_RESULTS_COMMAND, string>
    ;

export type WAPIResponse =
    | WAPIMessage<WAPIMessageType.PONG, null>;
