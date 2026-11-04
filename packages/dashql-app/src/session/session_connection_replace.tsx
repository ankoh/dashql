import * as React from 'react';

import { useDeleteConnection } from '../connections/connection_deletion.js';
import { useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { REPLACE_CONNECTION } from './scripts/session_scripts.js';
import { useConnectionScriptsDispatch } from './scripts/session_scripts_registry.js';

const LOG_CTX = 'connection_replace';

/// The outcome of a replacement
export interface ConnectionReplacement {
    /// Was the replaced connection removed?
    removed: boolean;
}

/// Replace a connection with another one
export type ConnectionReplace = (sourceId: string, targetId: string) => Promise<ConnectionReplacement>;

/// Replace a connection with another one in every session.
///
/// The replacement runs in steps that can be repeated, an interrupted replacement continues with the next one:
///  1. The scripts and the pending connections of the sessions move to the other connection.
///  2. The session files are written right away, they name the other connection then. A write that
///     fails stays pending and is written again by the next replacement.
///  3. The connection is removed once it is dead: no session uses it and every session file was written.
///     It is shut down and deleted with its folder, see useDeleteConnection.
///
/// A connection that is not removed stays in the registry and in the manifest, a session that still names
/// it after a restart moves with the next replacement.
export function useReplaceConnection(): ConnectionReplace {
    const registryStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const scriptsDispatch = useConnectionScriptsDispatch();
    const storage = useStorageWriter();
    const deleteConnection = useDeleteConnection();
    const logger = useLogger();

    return React.useCallback(async (sourceId: string, targetId: string) => {
        const target = registryStore.current.connections.get(targetId);
        if (target == null || sourceId === targetId || !registryStore.current.connections.has(sourceId)) {
            return { removed: false };
        }
        const moving = references.sessionsOf(sourceId).length;
        await scriptsDispatch(sourceId, { type: REPLACE_CONNECTION, value: { from: sourceId, into: target } });

        // The sessions of the target include the sessions that moved before and whose files were not written then
        const sessionIds = new Set([...references.sessionsOf(sourceId), ...references.sessionsOf(targetId)]);
        const written = await Promise.all([...sessionIds].map(async sessionId => [sessionId, await storage.flushSession(sessionId)] as const));
        const unwritten = written.filter(([, ok]) => !ok).map(([sessionId]) => sessionId);
        const remaining = references.sessionsOf(sourceId);
        if (unwritten.length > 0 || remaining.length > 0) {
            logger.warn('kept the replaced connection', {
                connectionId: sourceId,
                target: targetId,
                unwritten: unwritten.join(','),
                remaining: remaining.join(','),
            }, LOG_CTX);
            return { removed: false };
        }
        await deleteConnection(sourceId);
        logger.info('replaced connection', { connectionId: sourceId, target: targetId, sessions: moving.toString() }, LOG_CTX);
        return { removed: !registryStore.current.connections.has(sourceId) };
    }, [deleteConnection, logger, references, registryStore, scriptsDispatch, storage]);
}
