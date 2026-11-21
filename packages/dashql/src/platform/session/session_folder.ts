// The folder of the session of `dashql connect` (docs/design/agent_session.md): `.dashql/session/` in the folder that
// the harness works in, one session per folder. It holds the file of the session with the address of its server for
// the commands of the agent, the connections that the agent may use and the copies of the workbooks of the tab, and
// goes when the session ends.

/// The folder of DashQL in the folder that the harness works in, it ignores itself
export const DASHQL_FOLDER = '.dashql';
/// The folder of the session in it
export const SESSION_FOLDER = 'session';
/// The folder of the session relative to the folder that the harness works in
export const SESSION_FOLDER_PATH = `${DASHQL_FOLDER}/${SESSION_FOLDER}`;
/// The file of the session in its folder: its id and the address and the token of its server
export const SESSION_FILE = 'session.json';
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

/// The id of a workbook that a page copies, a folder name: letters, digits, `-` and `_`
export function isWorkbookCopyId(id: string): boolean {
    return /^[\w-]{1,64}$/.test(id);
}

/// The copy of a workbook relative to the folder that the harness works in, `.dashql/session/workbooks/<workbook id>`
export function workbookCopyPath(workbookId: string): string {
    if (!isWorkbookCopyId(workbookId)) throw new Error(`invalid workbook id ${JSON.stringify(workbookId)}`);
    return `${SESSION_FOLDER_PATH}/${SESSION_WORKBOOK_COPIES}/${workbookId}`;
}

/// The file of a session: its id and the address of its server
export interface SessionFile {
    id: string;
    endpoint: string;
    token: string;
}

/// The session of a text of SESSION_FILE, null if it is no session
export function parseSessionFile(text: string): SessionFile | null {
    try {
        const value = JSON.parse(text) as { id?: unknown; endpoint?: unknown; token?: unknown };
        return typeof value?.id === 'string' && typeof value.endpoint === 'string' && typeof value.token === 'string'
            ? { id: value.id, endpoint: value.endpoint, token: value.token }
            : null;
    } catch {
        return null;
    }
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
