import * as React from 'react';
import { ComputationAction, ComputationState, createComputationState, reduceComputationState } from "./computation_state.js";
import { Dispatch } from '../utils/variant.js';
import { useLogger } from '../platform/logger_provider.js';
import { useDashQLComputeWorker } from './compute_provider.js';
import { AsyncDataFrameRegistry } from './compute_worker_bindings.js';

const COMPUTATION_SCHEDULER_CTX = React.createContext<[ComputationState, Dispatch<ComputationAction>] | null>(null);

export const useComputationRegistry = () => React.useContext(COMPUTATION_SCHEDULER_CTX)!;

interface ComputationRegistryProps {
    children: React.ReactElement[] | React.ReactElement;
}

export function ComputationRegistry(props: ComputationRegistryProps) {
    const logger = useLogger();
    const worker = useDashQLComputeWorker();
    const dataFrameMemory = React.useMemo(() => new AsyncDataFrameRegistry(logger), []);
    const reducer = React.useCallback((state: ComputationState, action: ComputationAction) => {
        return reduceComputationState(state, action, dataFrameMemory, logger);
    }, [dataFrameMemory, logger, worker]);
    const [state, dispatch] = React.useReducer(reducer, null, createComputationState);
    return (
        <COMPUTATION_SCHEDULER_CTX.Provider value={[state, dispatch]}>
            {props.children}
        </COMPUTATION_SCHEDULER_CTX.Provider>
    );
}
