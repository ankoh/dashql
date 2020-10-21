import * as State from './root_state';
import { RootAction } from './root_action';

const MAX_LOG_SIZE = 100;

export function reducer(
    state: State.RootState = new State.RootState(),
    action: RootAction,
): State.RootState {
    switch (action.type) {
        case 'PUSH_LOG_ENTRY':
            return {
                ...state,
                logs: state.logs.withMutations(list => {
                    list.unshift(action.payload);
                    if (list.size > MAX_LOG_SIZE) {
                        list.pop();
                    }
                }),
            };
        case 'CONFIGURE_APP':
            return {
                ...state,
                appSettings: action.payload,
            };
        default:
            return state;
    }
}

export default reducer;

