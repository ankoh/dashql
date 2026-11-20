// The folder of a session of `dashql connect` (docs/design/agent_session.md): `.dashql/sessions/<id>/` in the folder
// that the harness works in. It holds the address of the server for the commands of the agent, the connections that
// the agent may use and the copies of the workbooks of the tab, and goes when the session ends.

/// The folder of DashQL in the folder that the harness works in, it ignores itself
export const DASHQL_FOLDER = '.dashql';
/// The folder of the sessions in it, one folder per session
export const SESSIONS_FOLDER = 'sessions';
/// The folder of the copies of the workbooks of the tab in the folder of a session, `workbooks/<workbook id>/`
export const SESSION_WORKBOOK_COPIES = 'workbooks';
/// The file of the connections that the tab lets the agent use, in the folder of a session
export const SESSION_CONNECTIONS_FILE = 'connections.json';

/// A connection that the agent may use
export interface SessionConnection {
    connectionId: string;
    /// The label of the connection in the tab
    name: string;
}

/// The connections that the agent may use, the contents of SESSION_CONNECTIONS_FILE
export interface SessionConnections {
    connections: SessionConnection[];
}

/// The connections of a text of SESSION_CONNECTIONS_FILE, null if it holds none
export function parseSessionConnections(text: string): SessionConnections | null {
    try {
        const value = JSON.parse(text) as { connections?: unknown };
        if (!Array.isArray(value?.connections)) return null;
        const connections = value.connections.flatMap((connection: { connectionId?: unknown; name?: unknown }) =>
            typeof connection?.connectionId === 'string' && connection.connectionId.length > 0
                ? [{ connectionId: connection.connectionId, name: typeof connection.name === 'string' ? connection.name : connection.connectionId }]
                : []);
        return { connections };
    } catch {
        return null;
    }
}

/// The id of a session, a folder name: letters, digits, `-` and `_`
export function isSessionName(name: string): boolean {
    return /^[\w-]{1,64}$/.test(name);
}

/// The id of a workbook that a page copies, a folder name like the id of a session
export const isWorkbookCopyId = isSessionName;

/// The folder of a session relative to the folder that the harness works in, `.dashql/sessions/<id>`
export function sessionFolderPath(session: string): string {
    if (!isSessionName(session)) throw new Error(`invalid session name ${JSON.stringify(session)}`);
    return `${DASHQL_FOLDER}/${SESSIONS_FOLDER}/${session}`;
}

/// The copy of a workbook relative to the folder that the harness works in, `.dashql/sessions/<id>/workbooks/<workbook id>`
export function workbookCopyPath(session: string, workbookId: string): string {
    return `${sessionFolderPath(session)}/${SESSION_WORKBOOK_COPIES}/${workbookId}`;
}

/// A file of the copy of a workbook with its stamp
export interface CopyFile {
    /// The path in the copy, with forward slashes
    path: string;
    size: number;
    mtimeMs: number;
}

/// The copy of a workbook of the tab in a session, as the server stamps it
export interface SessionWorkbook {
    workbookId: string;
    /// The files of the copy
    files: CopyFile[];
}
