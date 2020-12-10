import { DashQLCoreBindings } from '@dashql/core';
import { compose, createStore as createReduxStore } from 'redux';
import * as model from './';

function actionSanitizer(action: model.ActionVariant) {
    return action;
}

function stateSanitizer(state: model.AppStateMutation) {
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

export default function createStore(core: DashQLCoreBindings): model.AppReduxStore {
    const store = createReduxStore<model.AppState, model.ActionVariant, any, any>(
        (state: model.AppState | undefined, variant: model.ActionVariant) => {
            return model.AppStateMutation.reduce(state, variant, core);
        },
        enhancer,
    );

    // Return the store
    return store;
}

