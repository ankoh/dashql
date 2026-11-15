import * as core from '@ankoh/dashql-core';

import { stringifyError, type Logger } from '../platform/logger/logger.js';
import { Store } from '../store/store.js';
import { createComputationState, reduceComputationState, type ComputationAction, type ComputationState } from './computation_state.js';
import { DataFrameRegistry } from './data_frame.js';
import type { CreateComputeQueryExecution } from './computation_tasks.js';

const LOG_CTX = 'computations';

/// The computations on query results
export interface Computations {
    store: Store<ComputationState>;
    dispatch: (action: ComputationAction) => void;
    dataFrames: DataFrameRegistry;
    /// Give the computations a core, e.g. the one that the runtime set up. The actions that waited for it run.
    setCore(instance: core.DashQL): void;
    /// Track the queries of the tasks, e.g. in the query history of the connection of a computation
    setQueryExecution(create: CreateComputeQueryExecution | null): void;
    /// Free the state, later actions are dropped
    destroy(): void;
}

/// Set up the core of the computations
export type SetupComputationsCore = (context: string) => Promise<core.DashQL>;

/// Create the computations, the runtime creates them and the shell of Hyper without one.
///
/// The state lives in the core (computation_native.ts) and the tasks of an analysis run there, on the compute database
/// of the analysis. The computations take a core that is set up already, or ask for one with the first action: the
/// actions before it wait and run in order once it is there. A platform without a core falls back to instantiating the
/// default one.
export function createComputations(logger: Logger, setupCore?: SetupComputationsCore | core.DashQL | null): Computations {
    const dataFrames = new DataFrameRegistry(logger);
    const setup = typeof setupCore === 'function' ? setupCore : null;
    const instance = typeof setupCore === 'function' || setupCore == null ? null : setupCore;
    const store = new Store<ComputationState>(createComputationState(instance));
    // The actions that wait for the core
    let pending: ComputationAction[] | null = null;
    let destroyed = false;
    let queryExecution: CreateComputeQueryExecution | null = null;
    // The tasks in the core change the state on their own
    const attach = () => {
        const native = store.current.native;
        native?.attach({
            memory: dataFrames,
            logger,
            onChange: () => {
                if (!destroyed) store.update(native.project());
            },
        });
        native?.setQueryExecution(queryExecution);
    };
    attach();

    // Reducing acquires and releases data frames, the store runs every action once
    const reduce = (action: ComputationAction) => store.update(state => reduceComputationState(state, action, dataFrames));
    const setCore = (instance: core.DashQL) => {
        if (destroyed || store.current.native != null) return;
        store.update(createComputationState(instance));
        attach();
        const waiting = pending ?? [];
        pending = null;
        for (const action of waiting) reduce(action);
    };
    const requestCore = async (): Promise<core.DashQL> => {
        if (setup != null) {
            try {
                return await setup('computations');
            } catch (e) {
                logger.warn('The platform has no core for the computations, instantiating the default one', { error: stringifyError(e) }, LOG_CTX);
            }
        }
        return await core.DashQL.create();
    };
    return {
        store,
        dispatch: action => {
            if (destroyed) return;
            if (store.current.native != null) {
                reduce(action);
                return;
            }
            if (pending == null) {
                pending = [];
                requestCore().then(setCore, error => {
                    logger.error('Failed to set up the core of the computations', { error: stringifyError(error) }, LOG_CTX);
                    pending = null;
                });
            }
            pending.push(action);
        },
        dataFrames,
        setCore,
        setQueryExecution: create => {
            queryExecution = create;
            store.current.native?.setQueryExecution(create);
        },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            pending = null;
            store.current.native?.destroy();
        },
    };
}
