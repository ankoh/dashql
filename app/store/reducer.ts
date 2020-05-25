import * as State from './root_state';
import { ActionType, RootAction } from './root_action';

const MAX_LOG_SIZE = 100;

export function reducer(
    state: State.RootState = new State.RootState(),
    a: RootAction,
): State.RootState {
    switch (a.type) {
        case ActionType.PUSH_LOG_ENTRY:
            return {
                ...state,
                logs: state.logs.withMutations(l => {
                    l.unshift(a.payload);
                    if (l.size > MAX_LOG_SIZE) {
                        l.pop();
                    }
                }),
            };
        case ActionType.CONFIGURE_APP:
            return {
                ...state,
                appSettings: a.payload,
            };
        case ActionType.PUSH_TQL_STATEMENTS:
            return {
                ...state,
                tqlStatements: state.tqlStatements.push(...a.payload),
            };
        case ActionType.SET_TQL_QUERY_RESULT:
            return {
                ...state,
                tqlQueryResults: state.tqlQueryResults.set(
                    a.payload[0],
                    a.payload[1],
                ),
            };
        case ActionType.OTHER:
            return state;
        default:
            return state;
    }
}

export default reducer;
