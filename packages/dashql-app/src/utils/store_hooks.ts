import * as React from 'react';

import type { UpdateScheduler } from '@akohn/dashql/runtime/store/update_scheduler';

import type { Store } from './store.js';

/// Schedules with the frames of the browser
export const FRAME_UPDATE_SCHEDULER: UpdateScheduler = {
    afterTask: callback => queueMicrotask(callback),
    beforeFrame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle as number),
};

/// Subscribe to the state of a store
export function useStoreState<T>(store: Store<T>): T {
    return React.useSyncExternalStore(store.subscribe, store.get);
}
