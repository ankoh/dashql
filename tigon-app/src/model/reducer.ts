import * as State from './root_state';
import { ActionType, RootAction } from './root_action';

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
        case ActionType.SET_EXPLORER_DATA_SOURCE:
            if (state.explorerDataSource) {
                state.explorerDataSource.destroy();
            }
            return {
                ...state,
                explorerDataSource: a.payload
            };
        case ActionType.SET_EXPLORER_PLAN:
            if (state.explorerPlan) {
                state.explorerPlan.destroy();
            }
            return {
                ...state,
                explorerPlan: a.payload
            };
        case ActionType.CONFIGURE_APP: 
            return {
                ...state,
                appSettings: a.payload,
            };
        case ActionType.NAVIGATE_ROOT: return { ...state, rootView: a.payload };
        case ActionType.OTHER: return state;
        default: return state;
    }
}

export default reducer;

