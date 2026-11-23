import * as React from 'react';

import { useDeleteConnection } from '../../connections/connection_deletion.js';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';

/// The outcome of a replacement
export interface ConnectionReplacement {
    /// Was the replaced connection removed?
    removed: boolean;
}

/// Replace a connection with another one
export type ConnectionReplace = (sourceId: string, targetId: string) => Promise<ConnectionReplacement>;

/// Replace connections with a target connection in every workbook, resolves with the replaced connections that were
/// removed
export type ConnectionsReplace = (sourceIds: readonly string[], targetId: string) => Promise<string[]>;

/// Replace connections with a target connection in every workbook, see `replaceConnections` of the runtime: it moves
/// the workbooks and writes their files, and names the replaced connections that are dead. Those are shut down and
/// deleted with their folders, see useDeleteConnection.
export function useReplaceConnections(): ConnectionsReplace {
    const runtime = useOptionalRuntime();
    const deleteConnection = useDeleteConnection();

    return React.useCallback(async (sourceIds: readonly string[], targetId: string) => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        const dead = await runtime.replaceConnections(sourceIds, targetId);
        for (const connectionId of dead) {
            await deleteConnection(connectionId);
        }
        runtime.flush();
        return dead.filter(connectionId => runtime.store.get('connection', connectionId) == null);
    }, [deleteConnection, runtime]);
}

/// Replace a connection with another one in every workbook, see useReplaceConnections
export function useReplaceConnection(): ConnectionReplace {
    const replaceConnections = useReplaceConnections();
    return React.useCallback(async (sourceId: string, targetId: string) => {
        const removed = await replaceConnections([sourceId], targetId);
        return { removed: removed.includes(sourceId) };
    }, [replaceConnections]);
}
