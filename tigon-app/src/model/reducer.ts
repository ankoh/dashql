import * as State from './root_state'; import { ActionType, RootAction } from './root_action';

const MAX_LOG_SIZE = 100;

export function reducer(state: State.RootState = new State.RootState(), a: RootAction): State.RootState {
    switch (a.type) {
        case ActionType.PUSH_LOG_ENTRY:
            {
                return {
                    ...state,
                    logs: state.logs.withMutations(l => {
                        l.unshift(a.payload);
                        if (l.size > MAX_LOG_SIZE) {
                            l.pop();
                        }
                    }),
                };
            };
        case ActionType.CONFIGURE_APP: 
            return {
                ...state,
                appSettings: a.payload,
            };
        case ActionType.NAVIGATE_ROOT: return { ...state, rootView: a.payload };
        case ActionType.PUSH_TRANSIENT_TQL_STATEMENT: {
            return {
                ...state,
                transientTQLStatements: state.transientTQLStatements.push(a.payload)
            }
        };
        case ActionType.OTHER: return state;
        default: return state;
    }
}

export default reducer;

