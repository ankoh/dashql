export enum LogLevel {
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

export enum LogEntryType {
    CONNECT,
    DISCONNECT,
    OPEN,
    QUERY,
    ITER_NEXT,
    ITER_REWIND,
}

export enum LogEvent {
    OK,
    ERROR,
    START
}

export enum LogOrigin {
    WEB_WORKER,
    NODE_WORKER,
    BINDINGS,
    CHUNK_BUFFER,
    CHUNK_STREAM,
    ROW_ITERATOR,
    ASYNC_CHUNK_BUFFER,
    ASYNC_CHUNK_STREAM,
    ASYNC_ROW_ITERATOR,
}

export type LogEntry<O, T, E, V> = {
    readonly origin: O;
    readonly type: T;
    readonly event: E;
    readonly value: V;
    readonly level: LogLevel;
    readonly timestamp: Date;
};

export type LogEntryVariant =
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.QUERY, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.QUERY, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.QUERY, LogEvent.START, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.CONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.CONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.DISCONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.DISCONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.OPEN, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.OPEN, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogEntryType.OPEN, LogEvent.START, void>
    ;

