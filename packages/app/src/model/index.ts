/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
import { AppState } from './state';
import { Store } from 'redux';

// Export things
export * from './launch_step';
export * from './persistent_state';
export * from './app_config';
export * from './state';
export * from './state_mutation';

import createDevStore from './store_dev';
import createProdStore from './store_prod';

// The store type
export type AppReduxStore = Store<AppState>;

/// Create the store with respect to the environment
export function createStore(): AppReduxStore {
    if (process.env.NODE_ENV === 'production') {
        return createProdStore();
    } else {
        return createDevStore();
    }
}
