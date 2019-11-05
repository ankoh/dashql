import { Store as ReduxStore } from 'redux';
import { RootState } from './root_state';
import { RootAction } from './root_action';

// Export things
export * from './data_source';
export * from './data_viz';
export * from './grid_layout';
export * from './query_plan';
export * from './reducer';
export * from './root_action';
export * from './root_state';
export * from './store';
export * from './workbook';

// The action dispatch
export type Dispatch = (action: RootAction) => void;
// The store type
export type ReduxStore = ReduxStore<RootState>;

