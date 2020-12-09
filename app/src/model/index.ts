import { Store } from 'redux';
import { AppState } from './state';
import { ActionVariant } from './state_mutation';

// Export things
export * from './settings';
export * from './state';
export * from './state_mutation';
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
