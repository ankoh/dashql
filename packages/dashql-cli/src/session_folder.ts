// The session of `dashql connect` that a command runs in and its folder (@akohn/dashql/platform/session/session_folder)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
    DASHQL_FOLDER,
    isSessionName,
    isWorkbookCopyId,
    parseSessionConnections,
    sessionFolderPath,
    SESSION_CONNECTIONS_FILE,
    SESSION_WORKBOOK_COPIES,
    SESSIONS_FOLDER,
    workbookCopyPath,
    type SessionConnections,
} from '@akohn/dashql/platform/session/session_folder';

/// The file with the address of the server in the folder of a session
export const SESSION_SERVER_FILE = 'server.json';

/// The folder of a session in its workspace, `.dashql/sessions/<session>/`
export function sessionFolder(workspace: string, session: string): string {
    return path.join(workspace, ...sessionFolderPath(session).split('/'));
}

/// The folder of the copies of the workbooks of the tab in a session, `.dashql/sessions/<session>/workbooks/`
export function sessionCopiesFolder(workspace: string, session: string): string {
    return path.join(sessionFolder(workspace, session), SESSION_WORKBOOK_COPIES);
}

/// The session that a command runs in, from --workspace and --session
export interface CommandSession {
    /// The folder of the session, else the invoking directory
    workspace: string;
    /// The id of the session of `dashql connect`, null outside of it
    session: string | null;
}

/// The session of a command from its arguments. Both name the session of `dashql connect`, as the start of the session
/// tells the agent; nothing comes from the environment. An error message when they are wrong, or when they are missing
/// for the copy of a workbook of a tab (`.dashql/sessions/<id>/workbooks/<workbook id>`), which only a session runs.
export function commandSession(cwd: string, workspace: string | null, session: string | null, workbookFolder: string | null): CommandSession | string {
    if (session == null) {
        if (workbookFolder != null && isWorkbookCopyFolder(path.resolve(cwd, workbookFolder))) {
            return `${workbookFolder} is the copy of a workbook of the tab of DashQL, pass --workspace <folder> --session <id> as the start of the session says`;
        }
        return { workspace: path.resolve(cwd, workspace ?? '.'), session: null };
    }
    if (workspace == null) return '--session needs --workspace, the folder of the session';
    if (!isSessionName(session)) return `invalid session ${JSON.stringify(session)}`;
    const resolved = path.resolve(cwd, workspace);
    if (!existsSync(sessionFolder(resolved, session))) return `no session ${session} runs in ${resolved}`;
    return { workspace: resolved, session };
}

/// Is a folder the copy of a workbook of a tab, `.dashql/sessions/<id>/workbooks/<workbook id>` of a folder?
function isWorkbookCopyFolder(folder: string): boolean {
    const up = (levels: number) => path.basename(path.resolve(folder, ...Array<string>(levels).fill('..')));
    return up(1) === SESSION_WORKBOOK_COPIES && up(3) === SESSIONS_FOLDER && up(4) === DASHQL_FOLDER;
}

/// The id of the workbook of a folder that the tab copied into a session, null for another folder
export function copiedWorkbookId({ workspace, session }: CommandSession, folder: string): string | null {
    if (session == null) return null;
    const id = path.basename(folder);
    return isWorkbookCopyId(id) && path.resolve(workspace, workbookCopyPath(session, id)) === path.resolve(folder) ? id : null;
}

/// The connections that the tab of a session lets the agent use, null outside a session and before the tab told them
export function readSessionConnections(workspace: string, session: string | null): SessionConnections | null {
    if (session == null || !isSessionName(session)) return null;
    try {
        return parseSessionConnections(readFileSync(path.join(sessionFolder(workspace, session), SESSION_CONNECTIONS_FILE), 'utf8'));
    } catch {
        return null;
    }
}

/// The server of a session, from the file that it writes into the folder of the session. Null outside a session.
export function readSessionServer(workspace: string, session: string | null): { endpoint: string; token: string } | null {
    if (session == null || !isSessionName(session)) return null;
    try {
        const value = JSON.parse(readFileSync(path.join(sessionFolder(workspace, session), SESSION_SERVER_FILE), 'utf8')) as { endpoint?: unknown; token?: unknown };
        return typeof value.endpoint === 'string' && typeof value.token === 'string' ? { endpoint: value.endpoint, token: value.token } : null;
    } catch {
        return null;
    }
}
