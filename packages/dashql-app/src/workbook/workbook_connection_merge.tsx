import * as React from 'react';

import { useOptionalRuntime } from '../runtime/runtime_hooks.js';
import { useReplaceConnection } from './workbook_connection_replace.js';

/// Merge connections into a target connection
export type ConnectionMerge = (targetId: string, sourceIds: readonly string[]) => Promise<void>;

/// Merge connections that describe the same database into one.
///
/// Each merged connection is replaced with the target, see useReplaceConnection: its workbooks move to the
/// target first, the merged connection is removed once no workbook uses it.
export function useMergeConnections(): ConnectionMerge {
    const runtime = useOptionalRuntime();
    const replaceConnection = useReplaceConnection();

    return React.useCallback(async (targetId: string, sourceIds: readonly string[]) => {
        for (const sourceId of sourceIds) {
            if (runtime?.store.get('connection', targetId) == null) return;
            await replaceConnection(sourceId, targetId);
        }
    }, [runtime, replaceConnection]);
}
