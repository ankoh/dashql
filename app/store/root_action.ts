import * as State from './root_state';
import * as proto from '@dashql/proto';

// ---------------------------------------------------------------------------
// The action creators
// ---------------------------------------------------------------------------

export class Action<T, P> {
    public readonly type: T;
    public readonly payload: P;

    constructor(type: T, payload: P) {
        this.type = type;
        this.payload = payload;
    }
}

export function createAction<T, P>(type: T, payload: P): Action<T, P> {
    return { type, payload };
}

export function pushLogEntry(log: State.LogEntry) {
    return createAction('PUSH_LOG_ENTRY' as 'PUSH_LOG_ENTRY', log);
}

export function configureApp(config: State.AppSettings) {
    return createAction('CONFIGURE_APP' as 'CONFIGURE_APP', config);
}

export function setTQLModule(module: proto.tql.Module) {
    return createAction('SET_TQL_MODULE' as 'SET_TQL_MODULE', module);
}

export function setTQLArgument(name: string, argument: State.Argument) {
    return createAction('SET_TQL_ARGUMENT' as 'SET_TQL_ARGUMENT', {
        name,
        argument,
    });
}

export function unsetTQLArgument(name: string) {
    return createAction('UNSET_TQL_ARGUMENT' as 'UNSET_TQL_ARGUMENT', name);
}

export function setTQLQueryResult(
    key: string,
    result: proto.engine.QueryResult,
) {
    return createAction(
        'SET_TQL_QUERY_RESULT' as 'SET_TQL_QUERY_RESULT',
        [key, result] as [string, proto.engine.QueryResult],
    );
}

export function setTQLGetHighlights(
    getLocations: (() => proto.tql.Location | undefined)[],
) {
    return createAction(
        'SET_TQL_GET_HIGHLIGHTS' as 'SET_TQL_GET_HIGHLIGHTS',
        getLocations,
    );
}

// ---------------------------------------------------------------------------
// The root action type
// ---------------------------------------------------------------------------

export type RootAction =
    | ReturnType<typeof pushLogEntry>
    | ReturnType<typeof configureApp>
    | ReturnType<typeof setTQLModule>
    | ReturnType<typeof setTQLArgument>
    | ReturnType<typeof unsetTQLArgument>
    | ReturnType<typeof setTQLQueryResult>
    | ReturnType<typeof setTQLGetHighlights>;
