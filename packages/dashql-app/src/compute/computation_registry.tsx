import * as React from 'react';

import type { ComputationAction, ComputationState } from '@ankoh/dashql-runtime/compute/computation_state';
import type { DataFrameRegistry } from '@ankoh/dashql-runtime/compute/data_frame';
import { createComputations, type Computations } from '@ankoh/dashql-runtime/compute/computations';
import type { Store } from '@ankoh/dashql-runtime/store/store';
import type { Dispatch } from '@ankoh/dashql-runtime/utils/variant';

import { useLogger } from '../platform/logger/logger_provider.js';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { storeWithoutRuntime, useStoreState } from '../utils/store_hooks.js';

// The computations on query results (packages/dashql-runtime/src/compute/computations.ts). The RuntimeProvider
// provides the ones of the runtime, the shell of Hyper has its own. The state changes with every computation task
// step while dispatch and the data frame registry are stable: consumers that only dispatch don't subscribe and don't
// re-render on every step.
const COMPUTATIONS_CTX = React.createContext<Computations | null>(null);
/// Provide the computations
export const ComputationsProvider = COMPUTATIONS_CTX.Provider;

/// Computations without a runtime, e.g. of the shell of Hyper, they live as long as the component. Their state lives in
/// the core of the provider above, without one in the default core.
export function StandaloneComputations(props: { children?: React.ReactNode }) {
    const logger = useLogger();
    const setupCore = useDashQLCoreSetup();
    const [computations] = React.useState(() => createComputations(logger, setupCore));
    return <COMPUTATIONS_CTX.Provider value={computations}>{props.children}</COMPUTATIONS_CTX.Provider>;
}

const NO_COMPUTATION_STORE = storeWithoutRuntime<ComputationState>('the computations');

/// The state of the computations, without them no state. Dispatch resolves them when it is called.
export function useComputationRegistry(): [ComputationState, Dispatch<ComputationAction>, DataFrameRegistry] {
    const computations = React.useContext(COMPUTATIONS_CTX);
    const state = useStoreState(computations?.store ?? NO_COMPUTATION_STORE);
    return [state, useComputationDispatch(), computations?.dataFrames as DataFrameRegistry];
}
/// Dispatch to the computations, resolved when it is called: a test may render a component without them as long as it
/// doesn't dispatch
export function useComputationDispatch(): Dispatch<ComputationAction> {
    const computations = React.useContext(COMPUTATIONS_CTX);
    return React.useCallback((action: ComputationAction) => {
        if (computations == null) throw new Error('the computations need a RuntimeProvider or StandaloneComputations');
        computations.dispatch(action);
    }, [computations]);
}
export const useDataFrameRegistry = (): DataFrameRegistry => React.useContext(COMPUTATIONS_CTX)?.dataFrames as DataFrameRegistry;
/// Get the computation state without subscribing to its changes
export const useComputationStore = (): Store<ComputationState> => React.useContext(COMPUTATIONS_CTX)?.store ?? NO_COMPUTATION_STORE;
