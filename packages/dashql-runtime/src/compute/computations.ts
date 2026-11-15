import type { Logger } from '../platform/logger/logger.js';
import { Store } from '../store/store.js';
import { createComputationState, reduceComputationState, type ComputationAction, type ComputationState } from './computation_state.js';
import { DataFrameRegistry } from './data_frame.js';

/// The computations on query results
export interface Computations {
    store: Store<ComputationState>;
    dispatch: (action: ComputationAction) => void;
    dataFrames: DataFrameRegistry;
}

/// Create the computations, the runtime creates them and the shell of Hyper without one
export function createComputations(logger: Logger): Computations {
    const dataFrames = new DataFrameRegistry(logger);
    const store = new Store<ComputationState>(createComputationState());
    return {
        store,
        // Reducing acquires and releases data frames, the store runs every action once
        dispatch: action => store.update(state => reduceComputationState(state, action, dataFrames)),
        dataFrames,
    };
}
