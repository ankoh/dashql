import { createStore as createReduxStore } from 'redux';
import * as Model from './';

export default function createStore(): Model.ReduxStore {
    return createReduxStore<Model.RootState, Model.RootAction, any, any>(
        Model.reducer,
    );
}
