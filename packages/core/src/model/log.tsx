// Copyright (c) 2021 The DashQL Authors

import React from 'react';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as Immutable from 'immutable';
import { Action, Dispatch, ProviderProps } from './model_context';

const MAX_LOG_SIZE = 100;

export { LogLevel } from '@dashql/duckdb/dist/duckdb.module.js';

export enum LogOrigin {
    NONE = 0,
    DB_MANAGER = 1001,
    SCRIPT_PIPELINE = 1002,
    SCAN_PROVIDER = 1003,
    TASK_SCHEDULER = 1004,
    LOAD_LOGIC = 1005,
    HTTP_MANAGER = 1006,
}

export enum LogTopic {
    NONE = 0,
    DB_CONNECT = 1001,
    DB_DISCONNECT = 1002,
    PARSE_PROGRAM = 1003,
    INSTANTIATE_PROGRAM = 1004,
    SCHEDULE_PROGRAM = 1005,
    REQUEST_SCAN = 1006,
    PREPARE_TASK = 1007,
    EXECUTE_TASK = 1008,
    EXECUTE = 1009,
    REQUEST = 1010,
}

export enum LogEvent {
    OK = 1,
    ERROR = 2,
    START = 3,
    CAPTURE = 4,
}

export type LogEntry<O, T, E, V> = duckdb.LogEntry<O, T, E, V>;

export type LogEntryVariant =
    | LogEntry<LogOrigin.NONE, LogTopic.NONE, LogEvent.CAPTURE, any>
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
    | LogEntry<LogOrigin.TASK_SCHEDULER, LogTopic.PREPARE_TASK, LogEvent.ERROR, any>
    | LogEntry<LogOrigin.TASK_SCHEDULER, LogTopic.EXECUTE_TASK, LogEvent.ERROR, any>
    | LogEntry<LogOrigin.HTTP_MANAGER, LogTopic.REQUEST, LogEvent.ERROR, any>
    | LogEntry<LogOrigin.HTTP_MANAGER, LogTopic.REQUEST, LogEvent.OK, any>
    | LogEntry<LogOrigin.LOAD_LOGIC, LogTopic.EXECUTE, LogEvent.OK, any>
    | LogEntry<LogOrigin.LOAD_LOGIC, LogTopic.EXECUTE, LogEvent.ERROR, any>
    | duckdb.LogEntryVariant;

export function getLogLevelLabel(level: duckdb.LogLevel): string {
    return duckdb.getLogLevelLabel(level);
}

export function getLogEventLabel(event: LogEvent | duckdb.LogEvent): string {
    return duckdb.getLogEventLabel(event);
}

export function getLogTopicLabel(topic: LogTopic | duckdb.LogTopic): string {
    switch (topic) {
        case LogTopic.NONE:
            return 'NONE';
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
        case LogTopic.PREPARE_TASK:
            return 'PREPARE';
        case LogTopic.EXECUTE_TASK:
            return 'EXECUTE';
        case LogTopic.EXECUTE:
            return 'EXECUTE';
        case LogTopic.REQUEST:
            return 'REQUEST';
        default:
            return duckdb.getLogTopicLabel(topic);
    }
}

export function getLogOriginLabel(origin: LogOrigin | duckdb.LogOrigin): string {
    switch (origin) {
        case LogOrigin.NONE:
            return 'NONE';
        case LogOrigin.DB_MANAGER:
            return 'DATABASE ACCESS';
        case LogOrigin.SCRIPT_PIPELINE:
            return 'SCRIPT PIPELINE';
        case LogOrigin.SCAN_PROVIDER:
            return 'SCAN PROVIDER';
        case LogOrigin.TASK_SCHEDULER:
            return 'TASK SCHEDULER';
        case LogOrigin.LOAD_LOGIC:
            return 'LOAD LOGIC';
        case LogOrigin.HTTP_MANAGER:
            return 'HTTP';
        default:
            return duckdb.getLogOriginLabel(origin);
    }
}

type LogState = {
    /// The entries
    entries: Immutable.List<LogEntryVariant>;
};

const PUSH_LOG_ENTRY = Symbol('PUSH_LOG_ENTRY');
type LogStateAction = Action<typeof PUSH_LOG_ENTRY, LogEntryVariant>;

const initialState = {
    entries: Immutable.List<LogEntryVariant>(),
};

const reducer = (state: LogState, action: LogStateAction): LogState => {
    switch (action.type) {
        case PUSH_LOG_ENTRY:
            return {
                entries: state.entries.withMutations(list => {
                    list.unshift(action.data);
                    if (list.size > MAX_LOG_SIZE) {
                        list.pop();
                    }
                }),
            };
    }
    return state;
};

export class Log {
    _state: LogState;
    _dispatch: Dispatch<LogStateAction>;

    constructor(state: LogState, dispatch: Dispatch<LogStateAction>) {
        this._state = state;
        this._dispatch = dispatch;
    }
    public pushBack(entry: LogEntryVariant): void {
        this._dispatch({
            type: PUSH_LOG_ENTRY,
            data: entry,
        });
    }
}

const logCtx = React.createContext<Log | null>(null);

export const ProgramStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const [s, d] = React.useReducer(reducer, initialState);
    const logger = React.useRef<Log>(new Log(s, d));
    React.useEffect(() => {
        logger.current._state = s;
    }, [s]);
    return <logCtx.Provider value={logger.current}>{props.children}</logCtx.Provider>;
};

export const useLog = (): Log => React.useContext(logCtx);