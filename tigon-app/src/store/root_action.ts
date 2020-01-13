import * as State from "./root_state";
import * as proto from 'tigon-proto';

// ---------------------------------------------------------------------------
// The action type
// ---------------------------------------------------------------------------

export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    NAVIGATE_ROOT           = 'NAVIGATE_ROOT',
    PUSH_LOG_ENTRY          = 'PUSH_LOG_ENTRY',
    PUSH_TQL_STATEMENTS     = 'PUSH_TRANSIENT_TQL_STATEMENTS',
    SET_TQL_QUERY_RESULT    = 'SET_TRANSIENT_QUERY_RESULT',
    OTHER                   = 'OTHER',
}

// ---------------------------------------------------------------------------
// The root action type
// ---------------------------------------------------------------------------

export type RootAction =
    | Action<ActionType.CONFIGURE_APP, State.AppSettings>
    | Action<ActionType.NAVIGATE_ROOT, State.RootView>
    | Action<ActionType.PUSH_LOG_ENTRY, State.LogEntry>
    | Action<ActionType.PUSH_TQL_STATEMENTS, Array<proto.tql.Statement>>
    | Action<ActionType.SET_TQL_QUERY_RESULT, [string, proto.engine.QueryResult]>
    | Action<ActionType.OTHER, {}>;

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

export function pushLogEntry(log: State.LogEntry): RootAction {
    return createAction(ActionType.PUSH_LOG_ENTRY, log);
}

export function navigateRoot(view: State.RootView): RootAction {
    return createAction(ActionType.NAVIGATE_ROOT, view);
}

export function configureApp(config: State.AppSettings): RootAction {
    return createAction(ActionType.CONFIGURE_APP, config);
}

export function pushTQLStatements(stmts: Array<proto.tql.Statement>): RootAction {
    return createAction(ActionType.PUSH_TQL_STATEMENTS, stmts);
}

export function setTQLQueryResult(key: string, result: proto.engine.QueryResult): RootAction {
    return createAction<ActionType.SET_TQL_QUERY_RESULT, [string, proto.engine.QueryResult]>(ActionType.SET_TQL_QUERY_RESULT, [key, result]);
}
