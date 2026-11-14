import * as React from 'react';
import type * as dashql from '@ankoh/dashql-core';

import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { embeddedConnection, newWorkbookConnection } from '@ankoh/dashql-sdk/connections/embedded_connection';
import { useConnectionAllocator, useConnectionRegistryStore } from './connection_registry.js';
import { getHyperLinkTabState } from './hyper/hyper_link_tab.js';

/// Resolve the connection that new workbooks start on, see `newWorkbookConnection`
export function useNewWorkbookConnection(): (dql: dashql.DashQL) => ConnectionState {
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    return React.useCallback(
        (dql: dashql.DashQL) => newWorkbookConnection(registryStore.current.connections, allocate, dql, getHyperLinkTabState().current),
        [allocate, registryStore],
    );
}

/// Resolve the connection to the embedded Hyper, see `embeddedConnection`
export function useEmbeddedConnection(): (dql: dashql.DashQL) => ConnectionState {
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    return React.useCallback(
        (dql: dashql.DashQL) => embeddedConnection(registryStore.current.connections.values(), allocate, dql),
        [allocate, registryStore],
    );
}
