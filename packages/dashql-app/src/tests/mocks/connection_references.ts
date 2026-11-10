import type { ConnectionReferences } from '../../connections/connection_registry.js';

/// The references of workbooks that use fixed connections (workbookId -> connectionIds, the default connection first)
export function fixedConnectionReferences(connectionsByWorkbook: Record<string, string[]> | Map<string, string[]>): ConnectionReferences {
    const workbooks = connectionsByWorkbook instanceof Map ? connectionsByWorkbook : new Map(Object.entries(connectionsByWorkbook));
    return {
        workbooksOf: connectionId => [...workbooks].filter(([, connectionIds]) => connectionIds.includes(connectionId)).map(([workbookId]) => workbookId),
        connectionsOf: workbookId => workbooks.get(workbookId) ?? [],
        subscribe: () => () => { },
    };
}
