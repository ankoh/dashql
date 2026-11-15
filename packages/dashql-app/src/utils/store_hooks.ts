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

/// A store of the runtime outside of its provider: no state and no changes, an update throws. The hooks hand it out
/// like the null of a missing context: a test may render a component without the runtime as long as the component
/// doesn't read the state or modify it.
export function storeWithoutRuntime<T>(what: string): Store<T> {
    const store = new Store<T>(null as T);
    store.update = () => { throw new Error(`${what} need a RuntimeProvider`); };
    return store;
}
