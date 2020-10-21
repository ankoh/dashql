import * as State from './root_state';

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

export type RootAction =
    | ReturnType<typeof pushLogEntry>
    | ReturnType<typeof configureApp>;

