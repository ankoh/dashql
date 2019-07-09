import { compose, createStore } from 'redux';
import * as Store from './store';

/* tslint:disable */
const windowIfDefined = typeof window === 'undefined' ? null : window as any;
let composeEnhancers = compose;
if (windowIfDefined && typeof windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ === 'function') {
    composeEnhancers = windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({serialize: true}) || compose;
}
const enhancer = composeEnhancers();
/* tslint:enable */

export default function configureStore(): Store.ReduxStore {
    const store = createStore<Store.RootState, Store.RootAction, any, any>(Store.reducer, enhancer);

    // Return the store
    return store;
}
