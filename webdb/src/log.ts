export enum LogLevel {
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

export enum LogTopic {
    CONNECT = 1,
    DISCONNECT = 2,
    OPEN = 3,
    QUERY = 4,
    ITER_NEXT = 5,
    ITER_REWIND = 6,
}

export enum LogEvent {
    OK = 1,
    ERROR = 2,
    START = 3,
    RUN = 4
}

export enum LogOrigin {
    WEB_WORKER = 1,
    NODE_WORKER = 2,
    BINDINGS = 3,
    CHUNK_BUFFER = 4,
    CHUNK_STREAM = 5,
    ROW_ITERATOR = 6,
    ASYNC_WEBDB = 7,
    ASYNC_CHUNK_BUFFER = 8,
    ASYNC_CHUNK_STREAM = 9,
    ASYNC_ROW_ITERATOR = 10,
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
    | LogEntry<LogOrigin.ASYNC_WEBDB, LogTopic.QUERY, LogEvent.RUN, string>
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

export function getLogLevelLabel(level: LogLevel) {
    switch (level) {
        case LogLevel.DEBUG:
            return "DEBUG";
        case LogLevel.INFO:
            return "INFO";
        case LogLevel.WARNING:
            return "WARNING";
        case LogLevel.ERROR:
            return "ERROR";
        default:
            return "?";
    }
}

export function getLogEventLabel(event: LogEvent) {
    switch (event) {
        case LogEvent.OK:
            return "OK";
        case LogEvent.ERROR:
            return "ERROR";
        case LogEvent.START:
            return "START";
        case LogEvent.RUN:
            return "RUN";
        default:
            return "?";
    }
}

export function getLogTopicLabel(topic: LogTopic) {
    switch (topic) {
        case LogTopic.CONNECT:
            return "CONNECT";
        case LogTopic.DISCONNECT:
            return "DISCONNECT";
        case LogTopic.OPEN:
            return "OPEN";
        case LogTopic.QUERY:
            return "QUERY";
        case LogTopic.ITER_NEXT:
            return "NEXT";
        case LogTopic.ITER_REWIND:
            return "REWIND";
        default:
            return "?";
    }
}

export function getLogOriginLabel(origin: LogOrigin) {
    switch (origin) {
        case LogOrigin.WEB_WORKER:
            return "WEB WORKER";
        case LogOrigin.NODE_WORKER:
            return "NODE WORKER";
        case LogOrigin.BINDINGS:
            return "WEBDB BINDINGS";
        case LogOrigin.CHUNK_BUFFER:
            return "CHUNK BUFFER";
        case LogOrigin.CHUNK_STREAM:
            return "CHUNK STREAM";
        case LogOrigin.ROW_ITERATOR:
            return "ROW ITERATOR";
        case LogOrigin.ASYNC_WEBDB:
            return "WEBDB";
        case LogOrigin.ASYNC_CHUNK_BUFFER:
            return "CHUNK BUFFER";
        case LogOrigin.ASYNC_CHUNK_STREAM:
            return "CHUNK STREAM";
        case LogOrigin.ASYNC_ROW_ITERATOR :
            return "ROW ITERATOR";
        default:
            return "?";
    }
}
