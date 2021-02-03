import * as webdb from '@dashql/webdb/dist/webdb_async';

export enum LogLevel {
    DEBUG = 1,
    INFO = 2,
    WARNING = 3,
    ERROR = 4,
}

export enum LogEntryType {
    DB_CONNECT,
    DB_DISCONNECT,
}

export enum LogEvent {
    OK,
    ERROR,
    START
}

export enum LogOrigin {
    DB_MANAGER,
}

export type LogEntry<O, T, E, V> = webdb.LogEntry<O, T, E, V>;

export type LogEntryVariant =
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_CONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_CONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_CONNECT, LogEvent.START, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_DISCONNECT, LogEvent.OK, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_DISCONNECT, LogEvent.ERROR, void>
    | LogEntry<LogOrigin.DB_MANAGER, LogEntryType.DB_DISCONNECT, LogEvent.START, void>
    | webdb.LogEntryVariant
    ;
