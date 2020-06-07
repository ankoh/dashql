import Immutable from 'immutable';
import * as State from './root_state';
import { ActionType, RootAction } from './root_action';

const MAX_LOG_SIZE = 100;

export function reducer(
    state: State.RootState = new State.RootState(),
    action: RootAction,
): State.RootState {
    switch (action.type) {
        case ActionType.PUSH_LOG_ENTRY:
            return {
                ...state,
                logs: state.logs.withMutations(list => {
                    list.unshift(action.payload);
                    if (list.size > MAX_LOG_SIZE) {
                        list.pop();
                    }
                }),
            };
        case ActionType.CONFIGURE_APP:
            return {
                ...state,
                appSettings: action.payload,
            };
        case ActionType.SET_TQL_QUERY_STATEMENTS:
            return {
                ...state,
                tqlStatements: Immutable.List(action.payload),
            };
        case ActionType.SET_TQL_QUERY_RESULT:
            return {
                ...state,
                tqlQueryResults: state.tqlQueryResults.set(
                    action.payload[0],
                    action.payload[1],
                ),
            };
        case ActionType.OTHER:
            return state;
        default:
            return state;
    }
}

export default reducer;
