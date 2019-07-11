import { Store as ReduxStore } from 'redux';
import { RootState } from './RootState';
import { RootAction } from './RootAction';

// Export things
export * from './Reducer';
export * from './RootAction';
export * from './RootState';
export * from './Store';

// The action dispatch
export type Dispatch = (action: RootAction) => void;
// The store type
export type ReduxStore = ReduxStore<RootState>;

