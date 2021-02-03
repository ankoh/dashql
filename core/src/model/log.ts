import * as webdb from '@dashql/webdb/dist/webdb_async';

export enum LogLevel {
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

export enum LogTopic {
    DB_CONNECT,
    DB_DISCONNECT,
    PARSE_PROGRAM,
    INSTANTIATE_PROGRAM,
    SCHEDULE_PROGRAM,
}

export enum LogEvent {
    OK,
    ERROR,
    START
}

export enum LogOrigin {
    DB_MANAGER,
    SCRIPT_PIPELINE,
}

export type LogEntry<O, T, E, V> = webdb.LogEntry<O, T, E, V>;

export type LogEntryVariant =
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.START, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_CONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.START, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogTopic.DB_DISCONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.SCRIPT_PIPELINE, LogTopic.PARSE_PROGRAM, LogEvent.START, string>
    | webdb.LogEntryVariant
    ;
