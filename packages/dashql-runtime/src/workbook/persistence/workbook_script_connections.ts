import type { ConnectionState } from '../../connections/connection_state.js';
import type { WorkbookConnection, WorkbookData } from '../../storage/storage_backend.js';
import { workbookFormat } from '../../storage/workbook_format.js';

/// A script of a workbook file with the connection it runs on
export interface ResolvedWorkbookScript {
    /// The file name
    name: string;
    /// The connection of the app the script runs on
    connection: ConnectionState;
    /// The connection that the workbook file names for the script if the app doesn't know it
    unresolvedConnectionId?: string;
}

/// The scripts of a workbook file resolved to connections of the app
export interface ResolvedWorkbookScripts {
    /// The scripts in feed order
    scripts: ResolvedWorkbookScript[];
    /// The connection that the first script of a workbook without scripts runs on, null if the workbook has scripts
    pendingConnection: ConnectionState | null;
    /// The workbook file that describes the resolved scripts. It differs from the stored one when
    /// script files were added or removed, connections were consolidated, or the workbook held
    /// copies of connections that no script uses.
    workbook: WorkbookData;
}

/// Resolve a connection of a workbook to a connection of the app, null if it is unknown.
/// `copy` is the copy that the workbook file holds, null if it holds none. A resolver may register
/// an unknown connection from its copy.
export type WorkbookConnectionResolver = (connectionId: string, copy: WorkbookConnection | null) => ConnectionState | null;

/// Resolve the scripts of a workbook file to the connections of the app.
///
/// Every path that turns a workbook file into scripts resolves here: the restoration of the app, an
/// import (through the restoration) and the reload of a native folder that changed on disk.
/// The workbook file lists the scripts in feed order with the ids of their connections, script files
/// without an entry are appended on the connection of the script before them. A script whose
/// connection can't be resolved runs on the fallback connection, the embedded database, and the
/// workbook file keeps its reference. A workbook without scripts resolves the connection it holds.
export function resolveWorkbookScripts(
    workbook: WorkbookData,
    fileNames: readonly string[],
    fallback: () => ConnectionState,
    resolve: WorkbookConnectionResolver,
    onUnresolved: (connectionId: string) => void = () => { },
): ResolvedWorkbookScripts {
    // The core resolves the scripts, the connections cross as JSON and come back by their ids
    const connections = new Map<string, ConnectionState>();
    const json = (connection: ConnectionState): string => {
        connections.set(connection.connectionId, connection);
        return JSON.stringify({ connectionId: connection.connectionId, params: connection.params });
    };
    const resolved = workbookFormat().resolveWorkbookScripts(workbook, fileNames.map(name => name.normalize('NFC')), {
        resolve: (connectionId, copy) => {
            const connection = resolve(connectionId, copy == null ? null : JSON.parse(copy) as WorkbookConnection);
            return connection == null ? null : json(connection);
        },
        fallback: () => json(fallback()),
        unresolved: onUnresolved,
    });
    const connectionOf = (connectionId: string): ConnectionState => {
        const connection = connections.get(connectionId);
        if (connection == null) throw new Error(`The resolution of the scripts returned an unknown connection ${connectionId}`);
        return connection;
    };
    return {
        scripts: resolved.scripts.map(script => ({
            name: script.name,
            connection: connectionOf(script.connectionId),
            ...(script.unresolvedConnectionId == null ? {} : { unresolvedConnectionId: script.unresolvedConnectionId }),
        })),
        pendingConnection: resolved.pendingConnectionId == null ? null : connectionOf(resolved.pendingConnectionId),
        workbook: resolved.workbook as WorkbookData,
    };
}

/// Does a resolved workbook file differ from the stored one in its scripts or connections?
export function workbookScriptsResolutionChanged(stored: WorkbookData, resolved: WorkbookData): boolean {
    return workbookFormat().resolutionChanged(stored, resolved);
}
