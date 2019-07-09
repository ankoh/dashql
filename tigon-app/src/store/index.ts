import { Store as ReduxStore } from 'redux';
import { RootState } from './Store';
import { RootAction } from './Action';

// Export things
export * from './Reducer';
export * from './Action';
export * from './Store';

// The action dispatch
export type Dispatch = (action: RootAction) => void;
// The store type
export type ReduxStore = ReduxStore<RootState>;

