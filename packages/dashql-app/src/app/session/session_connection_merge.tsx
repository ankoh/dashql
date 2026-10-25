import * as React from 'react';

import { useDeleteConnection } from '../connections/connection_deletion.js';
import { useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { MERGE_CONNECTION } from './scripts/session_scripts.js';
import { useConnectionScriptsDispatch } from './scripts/session_scripts_registry.js';

const LOG_CTX = 'connection_merge';

/// Merge connections into a target connection
export type ConnectionMerge = (targetId: string, sourceIds: readonly string[]) => Promise<void>;

/// Merge connections that describe the same database into one.
///
/// The loaded sessions of a merged connection move to the target first, no new queries start on the merged
/// connection then. The merged connection is shut down and deleted afterwards, see useDeleteConnection. Session
/// files that are not loaded keep naming the merged connection.
export function useMergeConnections(): ConnectionMerge {
    const registryStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const scriptsDispatch = useConnectionScriptsDispatch();
    const deleteConnection = useDeleteConnection();
    const logger = useLogger();

    return React.useCallback(async (targetId: string, sourceIds: readonly string[]) => {
        for (const sourceId of sourceIds) {
            const target = registryStore.current.connections.get(targetId);
            if (target == null) return;
            if (sourceId === targetId || !registryStore.current.connections.has(sourceId)) continue;
            const sessions = references.sessionsOf(sourceId).length;
            await scriptsDispatch(sourceId, { type: MERGE_CONNECTION, value: { from: sourceId, into: target } });
            await deleteConnection(sourceId);
            logger.info('merged connection', { connectionId: sourceId, target: targetId, sessions: sessions.toString() }, LOG_CTX);
        }
    }, [deleteConnection, logger, references, registryStore, scriptsDispatch]);
}
