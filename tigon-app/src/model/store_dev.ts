import { compose, createStore as createReduxStore } from 'redux';
import * as Model from './';

function actionSanitizer(a: Model.RootAction) {
    return a;
}

function stateSanitizer(s: Model.RootState) {
    return s;
}

/* tslint:disable */
const windowIfDefined = typeof window === 'undefined' ? null : window as any;
let composeEnhancers = compose;
if (windowIfDefined && typeof windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ === 'function') {
    composeEnhancers = windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        serialize: false,
        stateSanitizer: stateSanitizer,
        actionSanitizer: actionSanitizer,
    }) || compose;
}
const enhancer = composeEnhancers();
/* tslint:enable */

export default function createStore(): Model.ReduxStore {
    const store = createReduxStore<Model.RootState, Model.RootAction, any, any>(Model.reducer, enhancer);

    // Return the store
    return store;
}
