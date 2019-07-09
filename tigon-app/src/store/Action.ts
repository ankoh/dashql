import * as Store from "./Store";

// ---------------------------------------------------------------------------
// The action type
// ---------------------------------------------------------------------------

export enum ActionType {
    CONFIGURE_APP           = 'CONFIGURE_APP',
    NAVIGATE_ROOT           = 'NAVIGATE_ROOT',
    NAVIGATE_SQL_LAB        = 'NAVIGATE_SQL_LAB',
    PUSH_LOG_ENTRY          = 'PUSH_LOG_ENTRY',
    SERVER_DESELECT         = 'SERVER_DESELECT',
    SERVER_INFO_UPDATE      = 'SERVER_STATUS_UPDATE',
    SERVER_SELECT           = 'SERVER_SELECT',
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
    | Action<ActionType.CONFIGURE_APP, Store.AppConfig>
    | Action<ActionType.NAVIGATE_ROOT, Store.RootView>
    | Action<ActionType.NAVIGATE_SQL_LAB, number>
    | Action<ActionType.PUSH_LOG_ENTRY, Store.LogEntry>
    | Action<ActionType.SERVER_DESELECT, {}>
    | Action<ActionType.SERVER_INFO_UPDATE, [string, Partial<Store.ServerInfo>]>
    | Action<ActionType.SERVER_SELECT, string>
    | Action<ActionType.LAB_QUERY_ABORT, {}>
    | Action<ActionType.LAB_QUERY_RESULT, Store.QueryResult>
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

export function pushLogEntry(log: Store.LogEntry): RootAction {
    return createAction<ActionType.PUSH_LOG_ENTRY, Store.LogEntry>(ActionType.PUSH_LOG_ENTRY, log);
}

export function navigateRoot(view: Store.RootView): RootAction {
    return createAction<ActionType.NAVIGATE_ROOT, Store.RootView>(ActionType.NAVIGATE_ROOT, view);
}

export function navigateLab(tabID: number): RootAction {
    return createAction<ActionType.NAVIGATE_SQL_LAB, number>(ActionType.NAVIGATE_SQL_LAB, tabID);
}

export function configureApp(config: Store.AppConfig): RootAction {
    return createAction<ActionType.CONFIGURE_APP, Store.AppConfig>(ActionType.CONFIGURE_APP, config);
}

export function selectServer(key: string): RootAction {
    return createAction<ActionType.SERVER_SELECT, string>(ActionType.SERVER_SELECT, key);
}

export function deselectServer(): RootAction {
    return createAction<ActionType.SERVER_DESELECT, {}>(ActionType.SERVER_DESELECT, {});
}

export function updateServerInfo(key: string, serverInfo: Partial<Store.ServerInfo>): RootAction {
    return createAction<ActionType.SERVER_INFO_UPDATE, [string, Partial<Store.ServerInfo>]>(ActionType.SERVER_INFO_UPDATE, [key, serverInfo]);
}

export function startLabQuery(): RootAction {
    return createAction<ActionType.LAB_QUERY_START, {}>(ActionType.LAB_QUERY_START, {});
}

export function abortLabQuery(): RootAction {
    return createAction<ActionType.LAB_QUERY_ABORT, {}>(ActionType.LAB_QUERY_ABORT, {});
}

export function storeQueryResult(result: Store.QueryResult): RootAction {
    return createAction<ActionType.LAB_QUERY_RESULT, Store.QueryResult>(ActionType.LAB_QUERY_RESULT, result);
}

export function updateLabTemplate(template: string): RootAction {
    return createAction<ActionType.LAB_TEMPLATE_UPDATE, string>(ActionType.LAB_TEMPLATE_UPDATE, template);
}
