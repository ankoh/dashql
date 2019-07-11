import * as State from './RootState';
import { ActionType, RootAction } from './RootAction';

const MAX_LOG_SIZE = 100;

export function reducer(state: State.RootState = new State.RootState(), a: RootAction): State.RootState {
    switch (a.type) {
        case ActionType.PUSH_LOG_ENTRY:
            {
                let warnings = state.logWarnings;
                if (a.payload.level >= State.LogLevel.LL_WARNING) {
                    warnings += 1;
                }
                if (state.logs.size >= MAX_LOG_SIZE && (state.logs.last() as State.LogEntry).level >= State.LogLevel.LL_WARNING) {
                    warnings -= 1;
                }
                return {
                    ...state,
                    logWarnings: warnings,
                    logs: state.logs.withMutations(l => {
                        l.unshift(a.payload);
                        if (l.size > MAX_LOG_SIZE) {
                            l.pop();
                        }
                    }),
                };
            };
        case ActionType.LAB_QUERY_ABORT:
            return {
                ...state,
                labQueryDuration: null,
                labQueryResult: null,
                labQueryStart: null,
            };
        case ActionType.LAB_QUERY_START:
            return {
                ...state,
                labQueryDuration: null,
                labQueryResult: null,
                labQueryStart: Date.now(),
            };
        case ActionType.LAB_QUERY_RESULT:
            const now = Date.now();
            return {
                ...state,
                labQueryDuration: now - (state.labQueryStart || now),
                labQueryResult: a.payload,
                labQueryStart: null,
            };
        case ActionType.LAB_TEMPLATE_UPDATE:
            return {
                ...state,
                labQueryTemplate: a.payload,
            };
        case ActionType.CONFIGURE_APP: 
            return {
                ...state,
                appConfig: a.payload,
                serverConfigs: state.serverConfigs.withMutations((mutableConfigs) => {
                    if (!a.payload.knownServers) { return; }
                    a.payload.knownServers.forEach(ks => {
                        const k = State.ServerConfig.buildKey(ks);
                        if (!mutableConfigs.has(k)) {
                            mutableConfigs.set(k, ks);
                        }
                    });
                })
            };
        case ActionType.NAVIGATE_ROOT: return { ...state, rootView: a.payload };
        case ActionType.NAVIGATE_DATA_EXPLORER: return { ...state, labView: a.payload };
        case ActionType.OTHER: return state;
        default: return state;
    }
}

export default reducer;

