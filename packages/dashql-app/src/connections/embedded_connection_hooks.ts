import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { embeddedConnection, newWorkbookConnection } from '@ankoh/dashql-runtime/connections/embedded_connection';
import { useConnectionAllocator, useConnectionRegistryStore } from './connection_registry.js';
import { getHyperLinkTabState } from './hyper/hyper_link_tab.js';

/// Resolve the connection that new workbooks start on, see `newWorkbookConnection`
export function useNewWorkbookConnection(): () => ConnectionState {
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    return React.useCallback(
        () => newWorkbookConnection(registryStore.current.connections, allocate, getHyperLinkTabState().current),
        [allocate, registryStore],
    );
}

/// Resolve the connection to the embedded Hyper, see `embeddedConnection`
export function useEmbeddedConnection(): () => ConnectionState {
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    return React.useCallback(
        () => embeddedConnection(registryStore.current.connections.values(), allocate),
        [allocate, registryStore],
    );
}
