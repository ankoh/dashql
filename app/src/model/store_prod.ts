import { createStore as createReduxStore } from 'redux';
import * as model from './';

export default function createStore(): model.AppReduxStore {
    return createReduxStore<model.AppState, model.ActionVariant, any, any>(
        model.AppStateMutation.reducer,
    );
}

