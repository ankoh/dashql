import * as Store from './Store';
import { ActionType, RootAction } from './Action';

const MAX_LOG_SIZE = 100;

function resetLab(): Partial<Store.RootState> {
    return {
        labQueryDuration: null,
        labQueryOptions: [],
        labQueryParameters: [],
        labQueryResult: null,
        labQueryStart: null,
        labQueryTemplate: "",
        labView: 0,
    };
}

function loadInitialLabDataSource(state: Store.RootState, serverKey: string): Partial<Store.RootState> {
    const conf = state.serverConfigs.get(serverKey);
    if (!conf || conf.queries.length === 0) { return {} }
    const ds = conf.queries[0];
    return {
        labQueryOptions: ds.options,
        labQueryParameters: ds.parameters,
        labQueryTemplate: ds.template.join('\n'),
    };
}

export function reducer(state: Store.RootState = new Store.RootState(), a: RootAction): Store.RootState {
    switch (a.type) {
        case ActionType.PUSH_LOG_ENTRY:
            {
                let warnings = state.logWarnings;
                if (a.payload.level >= Store.LogLevel.LL_WARNING) {
                    warnings += 1;
                }
                if (state.logs.size >= MAX_LOG_SIZE && (state.logs.last() as Store.LogEntry).level >= Store.LogLevel.LL_WARNING) {
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
        case ActionType.SERVER_SELECT: {
            return {
                ...state,
                ...resetLab(),
                ...loadInitialLabDataSource(state, a.payload),
                rootView: Store.RootView.SQL_LAB,
                selectedServer: a.payload,
            };
        }
        case ActionType.SERVER_DESELECT:
            return {
                ...state,
                rootView: Store.RootView.SERVER_SELECTOR,
                selectedServer: null,
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
        case ActionType.SERVER_INFO_UPDATE:
            return {
                ...state,
                serverInfos: state.serverInfos.update(a.payload[0], (s) => {
                    s = s || new Store.ServerInfo();
                    let cF = s.connectionFailures + 1;
                    let cH = s.connectionHeartbeat;
                    if (a.payload[1].connectionStatus === Store.ConnectionStatus.CS_CONNECTED) {
                        cF = 0;
                        cH = (cH + 1) & 1;
                    }
                    return {
                        ...s,
                        ...a.payload[1],
                        connectionFailures: cF,
                        connectionHeartbeat: cH,
                        lastUpdate: Date.now(),
                    };
                })
            };
        case ActionType.CONFIGURE_APP: 
            return {
                ...state,
                appConfig: a.payload,
                serverConfigs: state.serverConfigs.withMutations((mutableConfigs) => {
                    if (!a.payload.knownServers) { return; }
                    a.payload.knownServers.forEach(ks => {
                        const k = Store.ServerConfig.buildKey(ks);
                        if (!mutableConfigs.has(k)) {
                            mutableConfigs.set(k, ks);
                        }
                    });
                })
            };
        case ActionType.NAVIGATE_ROOT: return { ...state, rootView: a.payload };
        case ActionType.NAVIGATE_SQL_LAB: return { ...state, labView: a.payload };
        case ActionType.OTHER: return state;
        default: return state;
    }
}

export default reducer;

