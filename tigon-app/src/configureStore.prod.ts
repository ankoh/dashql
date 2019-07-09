import { createStore } from 'redux';
import * as Store from './store';

export default function configureStore(): Store.ReduxStore {
    return createStore<Store.RootState, Store.RootAction, any, any>(Store.reducer);
}

