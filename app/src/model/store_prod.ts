import { DashQLCoreBindings } from '@dashql/core';
import { createStore as createReduxStore } from 'redux';
import * as model from './';

export default function createStore(core: DashQLCoreBindings): model.AppReduxStore {
    return createReduxStore<model.AppState, model.ActionVariant, any, any>(
        (state: model.AppState | undefined, variant: model.ActionVariant) => {
            return model.AppStateMutation.reduce(state, variant, core);
        }
    );
}

