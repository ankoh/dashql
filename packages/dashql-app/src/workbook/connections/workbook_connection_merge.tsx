import * as React from 'react';

import { useReplaceConnections } from './workbook_connection_replace.js';

/// Merge connections into a target connection
export type ConnectionMerge = (targetId: string, sourceIds: readonly string[]) => Promise<void>;

/// Merge connections that describe the same database into one: the merged connections are replaced with the target,
/// see useReplaceConnections
export function useMergeConnections(): ConnectionMerge {
    const replaceConnections = useReplaceConnections();
    return React.useCallback(async (targetId: string, sourceIds: readonly string[]) => {
        await replaceConnections(sourceIds, targetId);
    }, [replaceConnections]);
}
