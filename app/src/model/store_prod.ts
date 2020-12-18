import { createStore as createReduxStore } from 'redux';
import * as model from './';

export default function createStore(): model.AppReduxStore {
    return createReduxStore<model.AppState, model.StateMutationVariant, any, any>(
        (state: model.AppState | undefined, variant: model.StateMutationVariant) => {
            return model.AppStateMutation.reduce(state, variant);
        }
    );
}

