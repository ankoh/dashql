import * as State from "./RootState";

// ---------------------------------------------------------------------------
// The action type
// ---------------------------------------------------------------------------

export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    NAVIGATE_ROOT           = 'NAVIGATE_ROOT',
    NAVIGATE_DATA_EXPLORER        = 'NAVIGATE_DATA_EXPLORER',
    PUSH_LOG_ENTRY          = 'PUSH_LOG_ENTRY',
    LAB_QUERY_ABORT         = 'LAB_QUERY_ABORT',
    LAB_QUERY_RESULT        = 'LAB_QUERY_RESULT',
    LAB_QUERY_START         = 'LAB_QUERY_START',
    LAB_TEMPLATE_UPDATE     = 'LAB_TEMPLATE_UPDATE',
    OTHER                   = 'OTHER',
}

// ---------------------------------------------------------------------------
// The root action type
// ---------------------------------------------------------------------------

export type RootAction =
    | Action<ActionType.CONFIGURE_APP, State.AppConfig>
    | Action<ActionType.NAVIGATE_ROOT, State.RootView>
    | Action<ActionType.NAVIGATE_DATA_EXPLORER, number>
    | Action<ActionType.PUSH_LOG_ENTRY, State.LogEntry>
    | Action<ActionType.LAB_QUERY_ABORT, {}>
    | Action<ActionType.LAB_QUERY_RESULT, State.QueryResult>
    | Action<ActionType.LAB_QUERY_START, {}>
    | Action<ActionType.LAB_TEMPLATE_UPDATE, string>
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

export function navigateLab(tabID: number): RootAction {
    return createAction<ActionType.NAVIGATE_DATA_EXPLORER, number>(ActionType.NAVIGATE_DATA_EXPLORER, tabID);
}

export function configureApp(config: State.AppConfig): RootAction {
    return createAction<ActionType.CONFIGURE_APP, State.AppConfig>(ActionType.CONFIGURE_APP, config);
}

export function startLabQuery(): RootAction {
    return createAction<ActionType.LAB_QUERY_START, {}>(ActionType.LAB_QUERY_START, {});
}

export function abortLabQuery(): RootAction {
    return createAction<ActionType.LAB_QUERY_ABORT, {}>(ActionType.LAB_QUERY_ABORT, {});
}

export function storeQueryResult(result: State.QueryResult): RootAction {
    return createAction<ActionType.LAB_QUERY_RESULT, State.QueryResult>(ActionType.LAB_QUERY_RESULT, result);
}

export function updateLabTemplate(template: string): RootAction {
    return createAction<ActionType.LAB_TEMPLATE_UPDATE, string>(ActionType.LAB_TEMPLATE_UPDATE, template);
}
