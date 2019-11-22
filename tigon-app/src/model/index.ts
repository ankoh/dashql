import { Store as ReduxStore } from 'redux';
import { RootState } from './root_state';
import { RootAction } from './root_action';

// Export things
export * from './viz';
export * from './reducer';
export * from './root_action';
export * from './root_state';
export * from './store';
export * from './viz';
export * from './viz_layout';

// The action dispatch
export type Dispatch = (action: RootAction) => void;
// The store type
export type ReduxStore = ReduxStore<RootState>;

