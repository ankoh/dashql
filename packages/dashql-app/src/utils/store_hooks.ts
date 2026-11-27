import * as React from 'react';

import type { Store } from './store.js';

/// Subscribe to the state of a store
export function useStoreState<T>(store: Store<T>): T {
    return React.useSyncExternalStore(store.subscribe, store.get);
}
