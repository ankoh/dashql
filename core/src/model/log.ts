import * as webdb from '@dashql/webdb/dist/webdb_async';

export import LogLevel = webdb.LogLevel;

export enum LogTopic {
    DB_CONNECT = 1001,
    DB_DISCONNECT = 1002,
    PARSE_PROGRAM = 1003,
    INSTANTIATE_PROGRAM = 1004,
    SCHEDULE_PROGRAM = 1005,
    REQUEST_SCAN = 1006,
}

export enum LogEvent {
    OK = 1,
    ERROR = 2,
    START = 3
}

export enum LogOrigin {
    DB_MANAGER = 1001,
    SCRIPT_PIPELINE = 1002,
    SCAN_PROVIDER = 1003,
}

export type LogEntry<O, T, E, V> = webdb.LogEntry<O, T, E, V>;

export type LogEntryVariant =
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.START, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.START, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.PARSE_PROGRAM, LogEvent.OK, string>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.PARSE_PROGRAM, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.INSTANTIATE_PROGRAM, LogEvent.OK, void>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.INSTANTIATE_PROGRAM, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.SCAN_PROVIDER, LogTopic.REQUEST_SCAN, LogEvent.OK, void>
    | webdb.LogEntryVariant
    ;

export function getLogLevelLabel(level: webdb.LogLevel) {
    return webdb.getLogLevelLabel(level);
}

export function getLogEventLabel(event: LogEvent | webdb.LogEvent) {
    return webdb.getLogEventLabel(event);
}

export function getLogTopicLabel(topic: LogTopic | webdb.LogTopic) {
    switch (topic) {
        case LogTopic.DB_CONNECT:
            return "CONNECT";
        case LogTopic.DB_DISCONNECT:
            return "DISCONNECT";
        case LogTopic.PARSE_PROGRAM:
            return "PARSE";
        case LogTopic.INSTANTIATE_PROGRAM:
            return "INSTANTIATE";
        case LogTopic.SCHEDULE_PROGRAM:
            return "SCHEDULE";
        case LogTopic.REQUEST_SCAN:
            return "REQUEST";
        default:
            return webdb.getLogTopicLabel(topic);
    }
}

export function getLogOriginLabel(origin: LogOrigin | webdb.LogOrigin) {
    switch (origin) {
        case LogOrigin.DB_MANAGER:
            return "DATABASE ACCESS";
        case LogOrigin.SCRIPT_PIPELINE:
            return "SCRIPT PIPELINE";
        case LogOrigin.SCAN_PROVIDER:
            return "SCAN PROVIDER";
        default:
            return webdb.getLogOriginLabel(origin);
    }
}
