import * as React from 'react';

import { useDeleteConnection } from '../connections/connection_deletion.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';

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
/// A connection that is not removed stays in the runtime and in the manifest, a workbook that still names
/// it after a restart moves with the next replacement.
export function useReplaceConnection(): ConnectionReplace {
    const runtime = useOptionalRuntime();
    const deleteConnection = useDeleteConnection();
    const logger = useLogger();

    return React.useCallback(async (sourceId: string, targetId: string) => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        const storage = runtime.storage;
        // The workbooks that use a connection, as the last flush of the store shows them
        const workbooksOf = (connectionId: string) => runtime.store.get('connection', connectionId)?.workbooks ?? [];
        const target = runtime.store.get('connection', targetId);
        if (target == null || sourceId === targetId || runtime.store.get('connection', sourceId) == null) {
            return { removed: false };
        }
        const moving = workbooksOf(sourceId);
        for (const workbookId of moving) {
            runtime.dispatch({ workbook: workbookId }, { kind: 'replaceConnection', value: { from: sourceId, into: targetId } });
        }
        // The connections show the workbooks that use them after the moved scripts
        runtime.flush();

        // The workbooks of the target include the workbooks that moved before and whose files were not written then
        const workbookIds = new Set([...moving, ...workbooksOf(sourceId), ...workbooksOf(targetId)]);
        const written = await Promise.all([...workbookIds].map(async workbookId => [workbookId, await storage.flushWorkbook(workbookId)] as const));
        const unwritten = written.filter(([, ok]) => !ok).map(([workbookId]) => workbookId);
        const remaining = workbooksOf(sourceId);
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
        logger.info('replaced connection', { connectionId: sourceId, target: targetId, workbooks: moving.length.toString() }, LOG_CTX);
        runtime.flush();
        return { removed: runtime.store.get('connection', sourceId) == null };
    }, [deleteConnection, logger, runtime]);
}
