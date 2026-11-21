// The workspace of DashQL and the session of `dashql connect` in it (@akohn/dashql/platform/session/session_folder). A
// workspace is the folder of the files of DashQL, marked by its workspace file: the `.dashql/` of the invoking directory
// unless --workspace names another, with no `.dashql/` inside it.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
    DASHQL_FOLDER,
    isWorkbookCopyId,
    parseWorkspaceFile,
    SESSION_BIN_FOLDER,
    SESSION_WORKBOOK_COPIES,
    WORKSPACE_FILE,
    WORKSPACE_FORMAT_VERSION,
    workbookCopyPath,
    type SessionConnections,
    type WorkspaceFile,
    type WorkspaceSession,
} from '@akohn/dashql/platform/session/session_folder';

/// The workspace of a command without --workspace, the `.dashql/` of the invoking directory
export const DEFAULT_WORKSPACE = DASHQL_FOLDER;

/// The `.gitignore` of a workspace, which ignores all of it
const GIT_IGNORE = '.gitignore';
const GIT_IGNORE_TEXT = '*\n';

/// The folder of the copies of the workbooks of the tab in a workspace, `workbooks/`
export function sessionCopiesFolder(workspace: string): string {
    return path.join(workspace, SESSION_WORKBOOK_COPIES);
}

/// The folder of the `dashql` of the agent of a session in a workspace, `bin/`
export function sessionBinFolder(workspace: string): string {
    return path.join(workspace, SESSION_BIN_FOLDER);
}

/// The workspace file of a folder, null for a folder that is no workspace
function readWorkspaceFile(folder: string): WorkspaceFile | null {
    try {
        return parseWorkspaceFile(readFileSync(path.join(folder, WORKSPACE_FILE), 'utf8'));
    } catch {
        return null;
    }
}

/// Write the workspace file at once, readable by the user only: it holds the token of the session
function writeWorkspaceFile(workspace: string, file: WorkspaceFile): void {
    const target = path.join(workspace, WORKSPACE_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(file)}\n`, { mode: 0o600 });
    renameSync(temp, target);
}

/// Set up a workspace: the folder with its workspace file and a `.gitignore` that ignores it. Only `dashql init` and
/// `dashql connect` do, the other commands take a workspace that is set up and fail on another folder.
export function initWorkspace(workspace: string): void {
    mkdirSync(workspace, { recursive: true });
    const ignore = path.join(workspace, GIT_IGNORE);
    try {
        readFileSync(ignore);
    } catch {
        writeFileSync(ignore, GIT_IGNORE_TEXT);
    }
    if (readWorkspaceFile(workspace) == null) writeWorkspaceFile(workspace, { formatVersion: WORKSPACE_FORMAT_VERSION });
}

/// Is a folder a workspace, one that `dashql init` or `dashql connect` set up? It has a workspace file.
export function isWorkspace(folder: string): boolean {
    return readWorkspaceFile(folder) != null;
}

/// Can `dashql init` set up a folder as a workspace? One that does not exist yet or is empty: a folder with files is a
/// project, whose files would mix with the files of DashQL. A workspace from before the workspace file, a folder whose
/// `.gitignore` ignores all of it, gets the file.
export function canInitWorkspace(folder: string): boolean {
    try {
        if (readdirSync(folder).length === 0) return true;
    } catch (error) {
        return (error as { code?: string }).code === 'ENOENT';
    }
    try {
        return readFileSync(path.join(folder, GIT_IGNORE), 'utf8').trim() === '*';
    } catch {
        return false;
    }
}

/// What a command says to a --workspace that is no workspace. It names no command that sets one up to the agent: an
/// agent that set up the folder of a wrong path would run it outside the tab.
export function noWorkspace(name: string): string {
    return `${name} is no workspace of DashQL, it has no ${WORKSPACE_FILE}. Pass the workspace that the start of the session of dashql connect names. Only the user sets up a workspace.`;
}

/// The session of `dashql connect` that runs in a workspace, from its workspace file. Null when none runs there.
export function readSession(workspace: string): WorkspaceSession | null {
    return readWorkspaceFile(workspace)?.session ?? null;
}

/// Put the session that runs in a workspace into its workspace file, null when none runs there
export function writeSession(workspace: string, session: WorkspaceSession | null): void {
    const file = readWorkspaceFile(workspace) ?? { formatVersion: WORKSPACE_FORMAT_VERSION };
    delete file.session;
    writeWorkspaceFile(workspace, session == null ? file : { ...file, session });
}

/// The id of the workbook of a folder that the tab copied into the session of a workspace, null for another folder
export function copiedWorkbookId(workspace: string, folder: string): string | null {
    const id = path.basename(folder);
    return isWorkbookCopyId(id) && path.resolve(workspace, workbookCopyPath(id)) === path.resolve(folder) ? id : null;
}

/// Is a folder the copy of a workbook of a tab in some workspace, `<workspace>/workbooks/<workbook id>`? A copy runs only
/// with the workspace of its session.
export function isWorkbookCopyFolder(folder: string): boolean {
    const parent = path.resolve(folder, '..');
    return path.basename(parent) === SESSION_WORKBOOK_COPIES && isWorkspace(path.resolve(parent, '..'));
}

/// The connections that the tab of the session of a workspace lets the agent use, null without a session and before the
/// tab told them
export function readSessionConnections(workspace: string): SessionConnections | null {
    const connections = readSession(workspace)?.connections;
    return connections == null ? null : { connections };
}
