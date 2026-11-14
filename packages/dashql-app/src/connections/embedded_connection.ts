import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { useConnectionAllocator, useConnectionRegistryStore, type ConnectionAllocator } from './connection_registry.js';
import { createDefaultHyperWasmConnectionState } from '@ankoh/dashql-sdk/connections/connection_params';
import { isHyperWasmConnection } from '@ankoh/dashql-sdk/connections/connection_label';
import { getHyperLinkTabState } from './hyper/hyper_link.js';

/// The connection to the embedded Hyper of the app, if one is known
export function findEmbeddedConnection(connections: Iterable<ConnectionState>): ConnectionState | null {
    for (const connection of connections) {
        if (isHyperWasmConnection(connection)) return connection;
    }
    return null;
}

/// The connection to the embedded Hyper, allocated when none is known.
/// The embedded engine is a single database, the app holds a single connection to it.
export function embeddedConnection(connections: Iterable<ConnectionState>, allocate: ConnectionAllocator, dql: dashql.DashQL): ConnectionState {
    return findEmbeddedConnection(connections) ?? allocate({ ...createDefaultHyperWasmConnectionState(dql), active: true });
}

/// The connection that new workbooks start on: the connection of the latest Hyper link of the tab, otherwise the
/// embedded Hyper. A cloud is no default, the app may have several (docs/design/cloud.md).
export function newWorkbookConnection(
    connections: Map<string, ConnectionState>,
    allocate: ConnectionAllocator,
    dql: dashql.DashQL,
    linkConnectionId: string | null = getHyperLinkTabState().current,
): ConnectionState {
    const linked = linkConnectionId == null ? null : connections.get(linkConnectionId);
    return linked ?? embeddedConnection(connections.values(), allocate, dql);
}

/// Resolve the connection that new workbooks start on, see `newWorkbookConnection`
export function useNewWorkbookConnection(): (dql: dashql.DashQL) => ConnectionState {
    const registryStore = useConnectionRegistryStore();
    const allocate = useConnectionAllocator();
    return React.useCallback(
        (dql: dashql.DashQL) => newWorkbookConnection(registryStore.current.connections, allocate, dql),
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
