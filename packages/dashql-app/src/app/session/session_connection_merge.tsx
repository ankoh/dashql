import * as React from 'react';

import { canMergeConnection } from '../connections/connection_merge.js';
import { useConnectionDispatch, useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { DELETE_CONNECTION } from '../connections/connection_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { MERGE_CONNECTION } from './scripts/session_scripts.js';
import { useConnectionScriptsDispatch } from './scripts/session_scripts_registry.js';

const LOG_CTX = 'connection_merge';

/// Merge connections into a target connection
export type ConnectionMerge = (targetId: string, sourceIds: readonly string[]) => Promise<void>;

/// Merge connections that describe the same database into one.
///
/// The loaded sessions of a merged connection move to the target first, the merged connection is
/// deleted with its folder once no session references it anymore. Session files that are not loaded
/// keep naming the merged connection. A connection that connected meanwhile is skipped.
export function useMergeConnections(): ConnectionMerge {
    const registryStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const connectionDispatch = useConnectionDispatch();
    const scriptsDispatch = useConnectionScriptsDispatch();
    const logger = useLogger();

    return React.useCallback(async (targetId: string, sourceIds: readonly string[]) => {
        for (const sourceId of sourceIds) {
            const target = registryStore.current.connections.get(targetId);
            const source = registryStore.current.connections.get(sourceId);
            if (target == null) return;
            if (source == null || sourceId === targetId || !canMergeConnection(source)) {
                logger.warn('skipping a connection that cannot be merged', { connectionId: sourceId, target: targetId }, LOG_CTX);
                continue;
            }
            const sessions = references.sessionsOf(sourceId).length;
            await scriptsDispatch(sourceId, { type: MERGE_CONNECTION, value: { from: sourceId, into: target } });
            connectionDispatch(sourceId, { type: DELETE_CONNECTION, value: null });
            logger.info('merged connection', { connectionId: sourceId, target: targetId, sessions: sessions.toString() }, LOG_CTX);
        }
    }, [connectionDispatch, logger, references, registryStore, scriptsDispatch]);
}
