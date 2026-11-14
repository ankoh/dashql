import type { ConnectionState } from '../../connections/connection_state.js';
import type { WorkbookConnection, WorkbookData, WorkbookScript } from '../../storage/storage_backend.js';
import { reconcileWorkbookScripts, sanitizeWorkbookFiles, withWorkbookScripts } from '../../storage/workbook_files.js';

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
    const copies = new Map(workbook.connections.map(connection => [connection.connectionId, connection]));
    const resolved = new Map<string, ConnectionState | null>();
    const resolveId = (connectionId: string): ConnectionState | null => {
        if (!resolved.has(connectionId)) {
            const connection = resolve(connectionId, copies.get(connectionId) ?? null);
            if (connection == null) onUnresolved(connectionId);
            resolved.set(connectionId, connection);
        }
        return resolved.get(connectionId) ?? null;
    };
    const scriptOf = (name: string, connectionId: string): ResolvedWorkbookScript => {
        const connection = resolveId(connectionId);
        return connection != null
            ? { name, connection }
            : { name, connection: fallback(), unresolvedConnectionId: connectionId };
    };
    const firstConnectionId = workbook.connections[0]?.connectionId ?? null;
    const listed = reconcileWorkbookScripts(sanitizeWorkbookFiles(workbook).scripts, fileNames, firstConnectionId ?? '').scripts;
    const scripts = listed.map(entry => scriptOf(entry.name, entry.connectionId));
    const pendingConnection = scripts.length > 0 ? null
        : (firstConnectionId == null ? null : resolveId(firstConnectionId)) ?? fallback();
    const list: WorkbookScript[] = scripts.map(script => ({ name: script.name, connectionId: script.unresolvedConnectionId ?? script.connection.connectionId }));
    const used = [...(pendingConnection == null ? [] : [pendingConnection]), ...scripts.map(script => script.connection)]
        .map(connection => ({ connectionId: connection.connectionId, params: connection.params }));
    return {
        scripts,
        pendingConnection,
        workbook: withWorkbookScripts(workbook, list, used),
    };
}

/// Does a resolved workbook file differ from the stored one in its scripts or connections?
export function workbookScriptsResolutionChanged(stored: WorkbookData, resolved: WorkbookData): boolean {
    const refs = (workbook: WorkbookData) => JSON.stringify([
        workbook.connections.map(connection => connection.connectionId),
        workbook.scripts ?? [],
    ]);
    return refs(stored) !== refs(resolved);
}
