import { compose, createStore as createReduxStore } from 'redux';
import * as Model from './';

function actionSanitizer(action: Model.ActionVariant) {
    return action;
}

function stateSanitizer(state: Model.AppState) {
    return {
        ...state
    };
}

/* tslint:disable */
const windowIfDefined = typeof window === 'undefined' ? null : (window as any);
let composeEnhancers = compose;
if (
    windowIfDefined &&
    typeof windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ === 'function'
) {
    composeEnhancers =
        windowIfDefined.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
            serialize: false,
            stateSanitizer: stateSanitizer,
            actionSanitizer: actionSanitizer,
        }) || compose;
}
const enhancer = composeEnhancers();
/* tslint:enable */

export default function createStore(): Model.AppReduxStore {
    const store = createReduxStore<Model.AppState, Model.ActionVariant, any, any>(
        Model.AppStateMutations.reducer,
        enhancer,
    );

    // Return the store
    return store;
}

