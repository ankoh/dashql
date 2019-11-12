import * as State from "./root_state";
import * as Model from "../model";
import * as proto from 'tigon-proto';

// ---------------------------------------------------------------------------
// The action type
// ---------------------------------------------------------------------------

export enum ActionType {
    CONFIGURE_APP               = 'CONFIGURE_APP',
    NAVIGATE_ROOT               = 'NAVIGATE_ROOT',
    PUSH_LOG_ENTRY              = 'PUSH_LOG_ENTRY',
    PUSH_TRANSIENT_TQL_MODULE    = 'SET_TRANSIENT_TQL_MODULE',
    OTHER                       = 'OTHER',
}

// ---------------------------------------------------------------------------
// The root action type
// ---------------------------------------------------------------------------

export type RootAction =
    | Action<ActionType.CONFIGURE_APP, State.AppSettings>
    | Action<ActionType.NAVIGATE_ROOT, State.RootView>
    | Action<ActionType.PUSH_LOG_ENTRY, State.LogEntry>
    | Action<ActionType.PUSH_TRANSIENT_TQL_MODULE, Model.CoreBuffer<proto.tql.TQLModule>>
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
    return createAction<ActionType.PUSH_LOG_ENTRY, State.LogEntry>(ActionType.PUSH_LOG_ENTRY, log);
}

export function navigateRoot(view: State.RootView): RootAction {
    return createAction<ActionType.NAVIGATE_ROOT, State.RootView>(ActionType.NAVIGATE_ROOT, view);
}

export function configureApp(config: State.AppSettings): RootAction {
    return createAction<ActionType.CONFIGURE_APP, State.AppSettings>(ActionType.CONFIGURE_APP, config);
}

export function pushTransientTQLModule(module: Model.CoreBuffer<proto.tql.TQLModule>): RootAction {
    return createAction<ActionType.PUSH_TRANSIENT_TQL_MODULE, Model.CoreBuffer<proto.tql.TQLModule>>(ActionType.PUSH_TRANSIENT_TQL_MODULE, module);
}
