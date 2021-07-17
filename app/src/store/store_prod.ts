import { createStore as createReduxStore } from 'redux';
import * as Model from './';

export default function createStore(): Model.AppReduxStore {
    return createReduxStore<Model.AppState, Model.ActionVariant, any, any>(
        Model.AppStateMutations.reducer,
    );
}

