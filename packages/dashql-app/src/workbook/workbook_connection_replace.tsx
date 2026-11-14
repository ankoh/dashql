import * as React from 'react';

import { useDeleteConnection } from '../connections/connection_deletion.js';
import { useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useStorageWriter } from '../storage/storage_provider.js';
import { REPLACE_CONNECTION } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { useConnectionScriptsDispatch } from './scripts/workbook_scripts_registry.js';

const LOG_CTX = 'connection_replace';

/// The outcome of a replacement
export interface ConnectionReplacement {
    /// Was the replaced connection removed?
    removed: boolean;
}

/// Replace a connection with another one
export type ConnectionReplace = (sourceId: string, targetId: string) => Promise<ConnectionReplacement>;

/// Replace a connection with another one in every workbook.
///
/// The replacement runs in steps that can be repeated, an interrupted replacement continues with the next one:
///  1. The scripts and the pending connections of the workbooks move to the other connection.
///  2. The workbook files are written right away, they name the other connection then. A write that
///     fails stays pending and is written again by the next replacement.
///  3. The connection is removed once it is dead: no workbook uses it and every workbook file was written.
///     It is shut down and deleted with its folder, see useDeleteConnection.
///
/// A connection that is not removed stays in the registry and in the manifest, a workbook that still names
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
        const moving = references.workbooksOf(sourceId).length;
        await scriptsDispatch(sourceId, { type: REPLACE_CONNECTION, value: { from: sourceId, into: target } });

        // The workbooks of the target include the workbooks that moved before and whose files were not written then
        const workbookIds = new Set([...references.workbooksOf(sourceId), ...references.workbooksOf(targetId)]);
        const written = await Promise.all([...workbookIds].map(async workbookId => [workbookId, await storage.flushWorkbook(workbookId)] as const));
        const unwritten = written.filter(([, ok]) => !ok).map(([workbookId]) => workbookId);
        const remaining = references.workbooksOf(sourceId);
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
        logger.info('replaced connection', { connectionId: sourceId, target: targetId, workbooks: moving.toString() }, LOG_CTX);
        return { removed: !registryStore.current.connections.has(sourceId) };
    }, [deleteConnection, logger, references, registryStore, scriptsDispatch, storage]);
}
