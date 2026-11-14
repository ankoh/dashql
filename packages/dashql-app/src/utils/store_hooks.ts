import * as React from 'react';

import { Store, UpdateQueue, type UpdateScheduler } from '@ankoh/dashql-runtime/store/store';

/// Schedules with the frames of the browser
export const FRAME_UPDATE_SCHEDULER: UpdateScheduler = {
    afterTask: callback => queueMicrotask(callback),
    beforeFrame: callback => requestAnimationFrame(callback),
    cancelFrame: handle => cancelAnimationFrame(handle as number),
};

/// Create the update queue of a store that lives as long as the component
export function useUpdateQueue<T>(store: Store<T>): UpdateQueue<T> {
    const [queue] = React.useState(() => new UpdateQueue(store, FRAME_UPDATE_SCHEDULER));
    React.useEffect(() => () => queue.dispose(), [queue]);
    return queue;
}

/// Create a store that lives as long as the component
export function useStore<T>(initial: () => T): Store<T> {
    const [store] = React.useState(() => new Store(initial()));
    return store;
}

/// Subscribe to the state of a store
export function useStoreState<T>(store: Store<T>): T {
    return React.useSyncExternalStore(store.subscribe, store.get);
}
