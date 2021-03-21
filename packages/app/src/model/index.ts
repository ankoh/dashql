import { AppState } from './state';
import { Store } from 'redux';

// Export things
export * from './launch_step';
export * from './persistent_state';
export * from './app_config';
export * from './state';
export * from './state_mutation';

// The store type
export type AppReduxStore = Store<AppState>;

/// Create the store with respect to the environment
export let createStore: () => AppReduxStore;
if (process.env.NODE_ENV === 'production') {
    createStore = require('./store_prod').default;
} else {
    createStore = require('./store_dev').default;
}
