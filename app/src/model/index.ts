import { DashQLCore } from '@dashql/core';
import { ActionVariant } from './state_mutation';
import { AppState } from './state';
import { Store } from 'redux';

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
export let createStore: (core: DashQLCore) => AppReduxStore;
if (process.env.NODE_ENV === 'production') {
    createStore = require('./store_prod').default;
} else {
    createStore = require('./store_dev').default;
}
