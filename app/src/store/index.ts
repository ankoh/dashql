import { Store } from 'redux';
import { AppState } from './app_state';
import { ActionVariant } from './app_state_mutations';

// Export things
export * from './app_settings';
export * from './app_state';
export * from './app_state_mutations';
export * from './log';
export * from './task';

// The action dispatch
export type Dispatch = (action: ActionVariant) => void;
// The store type
export type AppReduxStore = Store<AppState>;

/// Create the store with respect to the environment
export let createStore: () => AppReduxStore;
if (process.env.NODE_ENV === 'production') {
    createStore = require('./store_prod').default;
} else {
    createStore = require('./store_dev').default;
}
