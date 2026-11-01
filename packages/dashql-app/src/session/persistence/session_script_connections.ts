import type { ConnectionState } from '../../connections/connection_state.js';
import type { SessionConnection, SessionData, SessionScript } from '../../storage/storage_backend.js';
import { reconcileSessionScripts, sanitizeSessionFiles, withSessionScripts } from '../../storage/session_files.js';

/// A script of a session file with the connection it runs on
export interface ResolvedSessionScript {
    /// The file name
    name: string;
    /// The connection of the app the script runs on
    connection: ConnectionState;
    /// The connection that the session file names for the script if the app doesn't know it
    unresolvedConnectionId?: string;
}

/// The scripts of a session file resolved to connections of the app
export interface ResolvedSessionScripts {
    /// The scripts in feed order
    scripts: ResolvedSessionScript[];
    /// The connection that the first script of a session without scripts runs on, null if the session has scripts
    pendingConnection: ConnectionState | null;
    /// The session file that describes the resolved scripts. It differs from the stored one when
    /// script files were added or removed, connections were consolidated, or the session held
    /// copies of connections that no script uses.
    session: SessionData;
}

/// Resolve a connection of a session to a connection of the app, null if it is unknown.
/// `copy` is the copy that the session file holds, null if it holds none. A resolver may register
/// an unknown connection from its copy.
export type SessionConnectionResolver = (connectionId: string, copy: SessionConnection | null) => ConnectionState | null;

/// Resolve the scripts of a session file to the connections of the app.
///
/// Every path that turns a session file into scripts resolves here: the restoration of the app, an
/// import (through the restoration) and the reload of a native folder that changed on disk.
/// The session file lists the scripts in feed order with the ids of their connections, script files
/// without an entry are appended on the connection of the script before them. A script whose
/// connection can't be resolved runs on the fallback connection, the embedded database, and the
/// session file keeps its reference. A session without scripts resolves the connection it holds.
export function resolveSessionScripts(
    session: SessionData,
    fileNames: readonly string[],
    fallback: () => ConnectionState,
    resolve: SessionConnectionResolver,
    onUnresolved: (connectionId: string) => void = () => { },
): ResolvedSessionScripts {
    const copies = new Map(session.connections.map(connection => [connection.connectionId, connection]));
    const resolved = new Map<string, ConnectionState | null>();
    const resolveId = (connectionId: string): ConnectionState | null => {
        if (!resolved.has(connectionId)) {
            const connection = resolve(connectionId, copies.get(connectionId) ?? null);
            if (connection == null) onUnresolved(connectionId);
            resolved.set(connectionId, connection);
        }
        return resolved.get(connectionId) ?? null;
    };
    const scriptOf = (name: string, connectionId: string): ResolvedSessionScript => {
        const connection = resolveId(connectionId);
        return connection != null
            ? { name, connection }
            : { name, connection: fallback(), unresolvedConnectionId: connectionId };
    };
    const firstConnectionId = session.connections[0]?.connectionId ?? null;
    const listed = reconcileSessionScripts(sanitizeSessionFiles(session).scripts, fileNames, firstConnectionId ?? '').scripts;
    const scripts = listed.map(entry => scriptOf(entry.name, entry.connectionId));
    const pendingConnection = scripts.length > 0 ? null
        : (firstConnectionId == null ? null : resolveId(firstConnectionId)) ?? fallback();
    const list: SessionScript[] = scripts.map(script => ({ name: script.name, connectionId: script.unresolvedConnectionId ?? script.connection.connectionId }));
    const used = [...(pendingConnection == null ? [] : [pendingConnection]), ...scripts.map(script => script.connection)]
        .map(connection => ({ connectionId: connection.connectionId, params: connection.params }));
    return {
        scripts,
        pendingConnection,
        session: withSessionScripts(session, list, used),
    };
}

/// Does a resolved session file differ from the stored one in its scripts or connections?
export function sessionScriptsResolutionChanged(stored: SessionData, resolved: SessionData): boolean {
    const refs = (session: SessionData) => JSON.stringify([
        session.connections.map(connection => connection.connectionId),
        session.scripts ?? [],
    ]);
    return refs(stored) !== refs(resolved);
}
