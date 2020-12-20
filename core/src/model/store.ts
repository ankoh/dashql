import { createStore as createReduxStore } from 'redux';
import { StateMutationVariant, StateMutations } from './state_mutation';
import { DerivedState, DerivedReduxStore, CoreState } from './state';

export function createStore(): DerivedReduxStore {
    return createReduxStore<DerivedState, StateMutationVariant, any, any>(
        (state: DerivedState | undefined, variant: StateMutationVariant) => {
            if (!state) return { core: new CoreState() };
            const s = StateMutations.reduce(state.core, variant);
            return s === state.core ? state : {
                ...state,
                core: s 
            };
        }
    );
}


