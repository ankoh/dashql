import { DashQLCoreWasmBindings } from '@dashql/core';
import { createStore as createReduxStore } from 'redux';
import { ActionVariant } from './state_mutation';
import { AppState } from './state';
import { Store } from 'redux';
import * as model from './';

// Export things
export * from './settings';
export * from './state';
export * from './state_mutation';

// The action dispatch
export type Dispatch = (action: ActionVariant) => void;
// The store type
export type AppReduxStore = Store<AppState>;

export function createStore(core: DashQLCoreWasmBindings): model.AppReduxStore {
    return createReduxStore<model.AppState, model.ActionVariant, any, any>(
        (state: model.AppState | undefined, variant: model.ActionVariant) => {
            return model.AppStateMutation.reduce(state, variant, core);
        }
    );
}

