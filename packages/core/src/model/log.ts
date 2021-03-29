import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';

export import LogLevel = duckdb.LogLevel;

export enum LogOrigin {
    DB_MANAGER = 1001,
    SCRIPT_PIPELINE = 1002,
    SCAN_PROVIDER = 1003,
    ACTION_SCHEDULER = 1004,
}

export enum LogTopic {
    DB_CONNECT = 1001,
    DB_DISCONNECT = 1002,
    PARSE_PROGRAM = 1003,
    INSTANTIATE_PROGRAM = 1004,
    SCHEDULE_PROGRAM = 1005,
    REQUEST_SCAN = 1006,
    PREPARE_ACTION = 1007,
    EXECUTE_ACTION = 1008,
}

export enum LogEvent {
    OK = 1,
    ERROR = 2,
    START = 3,
}

export type LogEntry<O, T, E, V> = duckdb.LogEntry<O, T, E, V>;

export type LogEntryVariant =
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.START, undefined>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.OK, undefined>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.ERROR, undefined>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.START, undefined>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.OK, undefined>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.ERROR, undefined>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.PARSE_PROGRAM, LogEvent.OK, string>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.PARSE_PROGRAM, LogEvent.ERROR, undefined>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.INSTANTIATE_PROGRAM, LogEvent.OK, undefined>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.INSTANTIATE_PROGRAM, LogEvent.ERROR, undefined>
    | LogEntry<LogOrigin.SCAN_PROVIDER, LogTopic.REQUEST_SCAN, LogEvent.OK, undefined>
    | LogEntry<LogOrigin.ACTION_SCHEDULER, LogTopic.PREPARE_ACTION, LogEvent.ERROR, any>
    | LogEntry<LogOrigin.ACTION_SCHEDULER, LogTopic.EXECUTE_ACTION, LogEvent.ERROR, any>
    | duckdb.LogEntryVariant;

export function getLogLevelLabel(level: duckdb.LogLevel) {
    return duckdb.getLogLevelLabel(level);
}

export function getLogEventLabel(event: LogEvent | duckdb.LogEvent) {
    return duckdb.getLogEventLabel(event);
}

export function getLogTopicLabel(topic: LogTopic | duckdb.LogTopic) {
    switch (topic) {
        case LogTopic.DB_CONNECT:
            return 'CONNECT';
        case LogTopic.DB_DISCONNECT:
            return 'DISCONNECT';
        case LogTopic.PARSE_PROGRAM:
            return 'PARSE';
        case LogTopic.INSTANTIATE_PROGRAM:
            return 'INSTANTIATE';
        case LogTopic.SCHEDULE_PROGRAM:
            return 'SCHEDULE';
        case LogTopic.REQUEST_SCAN:
            return 'REQUEST';
        case LogTopic.PREPARE_ACTION:
            return 'PREPARE';
        case LogTopic.EXECUTE_ACTION:
            return 'EXECUTE';
        default:
            return duckdb.getLogTopicLabel(topic);
    }
}

export function getLogOriginLabel(origin: LogOrigin | duckdb.LogOrigin) {
    switch (origin) {
        case LogOrigin.DB_MANAGER:
            return 'DATABASE ACCESS';
        case LogOrigin.SCRIPT_PIPELINE:
            return 'SCRIPT PIPELINE';
        case LogOrigin.SCAN_PROVIDER:
            return 'SCAN PROVIDER';
        case LogOrigin.ACTION_SCHEDULER:
            return 'ACTION SCHEDULER';
        default:
            return duckdb.getLogOriginLabel(origin);
    }
}
