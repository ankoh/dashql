// The workspace of DashQL and the session of `dashql connect` in it (docs/design/agent_session.md). One session runs in
// a workspace and works in its root: the workspace file marks the workspace and names the session, with the address of
// its server for the hooks and the commands of the agent and the connections that the agent may use, and the copies of
// the workbooks of the tab are its workbooks, `workbooks/<workbook id>/`, as in the storage of the app. The session goes
// from the file and its copies go when it ends.

/// The default workspace, in the folder that the harness works in and the folder of a command: it ignores itself
export const DASHQL_FOLDER = '.dashql';
/// The file at the root of a workspace that marks it
export const WORKSPACE_FILE = 'dashql-workspace.json';
/// The version of the format of the workspace file and of the layout of the workspace
export const WORKSPACE_FORMAT_VERSION = 1;
/// The folder of the copies of the workbooks of the tab in the workspace, `workbooks/<workbook id>/`, the folder of the
/// workbooks of the storage of the app
export const SESSION_WORKBOOK_COPIES = 'workbooks';
/// The folder of the `dashql` of the agent of a session in the workspace
export const SESSION_BIN_FOLDER = 'bin';

/// A connection that the agent may use
export interface SessionConnection {
    connectionId: string;
    /// The label of the connection in the tab
    name: string;
}

/// The connections that the agent may use, as the tab sends them to the server of the session
export interface SessionConnections {
    connections: SessionConnection[];
}

/// The connections of a list, null if it is no list
function sessionConnectionsOf(value: unknown): SessionConnection[] | null {
    if (!Array.isArray(value)) return null;
    return value.flatMap((connection: { connectionId?: unknown; name?: unknown }) =>
        typeof connection?.connectionId === 'string' && connection.connectionId.length > 0
            ? [{ connectionId: connection.connectionId, name: typeof connection.name === 'string' ? connection.name : connection.connectionId }]
            : []);
}

/// The connections of a text that the tab sent, null if it holds none
export function parseSessionConnections(text: string): SessionConnections | null {
    try {
        const connections = sessionConnectionsOf((JSON.parse(text) as { connections?: unknown })?.connections);
        return connections == null ? null : { connections };
    } catch {
        return null;
    }
}

/// The id of a workbook that a page copies, a folder name: letters, digits, `-` and `_`
export function isWorkbookCopyId(id: string): boolean {
    return /^[\w-]{1,64}$/.test(id);
}

/// The copy of a workbook relative to the workspace, `workbooks/<workbook id>`
export function workbookCopyPath(workbookId: string): string {
    if (!isWorkbookCopyId(workbookId)) throw new Error(`invalid workbook id ${JSON.stringify(workbookId)}`);
    return `${SESSION_WORKBOOK_COPIES}/${workbookId}`;
}

/// The session of `dashql connect` that runs in a workspace: its id and the address and the token of its server
export interface WorkspaceSession {
    id: string;
    endpoint: string;
    token: string;
    /// The connections that the tab lets the agent use, absent before the tab told them
    connections?: SessionConnection[];
}

/// The contents of WORKSPACE_FILE
export interface WorkspaceFile {
    formatVersion: number;
    /// The session that runs in the workspace, absent while none runs
    session?: WorkspaceSession;
}

/// The workspace file of a text, null if it is none. A session that is no session is left out.
export function parseWorkspaceFile(text: string): WorkspaceFile | null {
    let value: { formatVersion?: unknown; session?: { id?: unknown; endpoint?: unknown; token?: unknown; connections?: unknown } };
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (value == null || typeof value !== 'object' || !Number.isInteger(value.formatVersion)) return null;
    const file: WorkspaceFile = { formatVersion: value.formatVersion as number };
    const session = value.session;
    if (typeof session?.id === 'string' && typeof session.endpoint === 'string' && typeof session.token === 'string') {
        file.session = { id: session.id, endpoint: session.endpoint, token: session.token };
        const connections = sessionConnectionsOf(session.connections);
        if (connections != null) file.session.connections = connections;
    }
    return file;
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
