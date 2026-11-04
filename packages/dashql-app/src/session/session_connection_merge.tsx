import * as React from 'react';

import { useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useReplaceConnection } from './session_connection_replace.js';

/// Merge connections into a target connection
export type ConnectionMerge = (targetId: string, sourceIds: readonly string[]) => Promise<void>;

/// Merge connections that describe the same database into one.
///
/// Each merged connection is replaced with the target, see useReplaceConnection: its sessions move to the
/// target first, the merged connection is removed once no session uses it.
export function useMergeConnections(): ConnectionMerge {
    const registryStore = useConnectionRegistryStore();
    const replaceConnection = useReplaceConnection();

    return React.useCallback(async (targetId: string, sourceIds: readonly string[]) => {
        for (const sourceId of sourceIds) {
            if (!registryStore.current.connections.has(targetId)) return;
            await replaceConnection(sourceId, targetId);
        }
    }, [registryStore, replaceConnection]);
}
