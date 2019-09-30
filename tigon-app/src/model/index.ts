import { Store as ReduxStore } from 'redux';
import { RootState } from './root_state';
import { RootAction } from './root_action';

// Export things
export * from './data_source';
export * from './query_plan';
export * from './reducer';
export * from './root_action';
export * from './root_state';
export * from './store';

// The action dispatch
export type Dispatch = (action: RootAction) => void;
// The store type
export type ReduxStore = ReduxStore<RootState>;

