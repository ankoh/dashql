export enum LogLevel {
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

export enum LogTopic {
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
    ASYNC_WEBDB,
    ASYNC_CHUNK_BUFFER,
    ASYNC_CHUNK_STREAM,
    ASYNC_ROW_ITERATOR,
}

export type LogEntry<O, T, E, V> = {
    readonly timestamp: Date;
    readonly level: LogLevel;
    readonly origin: O;
    readonly topic: T;
    readonly event: E;
    readonly value: V;
};

export type LogEntryVariant =
    | LogEntry<LogOrigin.BINDINGS, LogTopic.QUERY, LogEvent.START, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.QUERY, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.QUERY, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.CONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.CONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.DISCONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.DISCONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.OPEN, LogEvent.START, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.OPEN, LogEvent.OK, void>
    | LogEntry<LogOrigin.BINDINGS, LogTopic.OPEN, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.ASYNC_WEBDB, LogTopic.QUERY, LogEvent.START, string>
    ;

export interface Logger {
    log(entry: LogEntryVariant): void;
}

export class VoidLogger implements Logger {
    public log(_entry: LogEntryVariant): void {}
}

export class ConsoleLogger implements Logger {
    public log(entry: LogEntryVariant): void {
        console.log(entry);
    }
}
