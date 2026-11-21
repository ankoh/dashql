// The session of `dashql connect` in a workspace and its folder, `.dashql/session/` (@akohn/dashql/platform/session/session_folder)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
    DASHQL_FOLDER,
    isWorkbookCopyId,
    parseSessionConnections,
    parseSessionFile,
    SESSION_CONNECTIONS_FILE,
    SESSION_FILE,
    SESSION_FOLDER,
    SESSION_FOLDER_PATH,
    SESSION_WORKBOOK_COPIES,
    workbookCopyPath,
    type SessionConnections,
    type SessionFile,
} from '@akohn/dashql/platform/session/session_folder';

/// The folder of the session of a workspace, `.dashql/session/`
export function sessionFolder(workspace: string): string {
    return path.join(workspace, ...SESSION_FOLDER_PATH.split('/'));
}

/// The folder of the copies of the workbooks of the tab, `.dashql/session/workbooks/`
export function sessionCopiesFolder(workspace: string): string {
    return path.join(sessionFolder(workspace), SESSION_WORKBOOK_COPIES);
}

/// Set up a workspace: its `.dashql/`, which ignores itself. Only `dashql init` and `dashql connect` do, the other
/// commands take a workspace that is set up and fail on another folder.
export function initWorkspace(folder: string): void {
    const root = path.join(folder, DASHQL_FOLDER);
    mkdirSync(root, { recursive: true });
    const ignore = path.join(root, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
}

/// Is a folder a workspace, one that `dashql init` or `dashql connect` set up?
export function isWorkspace(folder: string): boolean {
    try {
        return statSync(path.join(folder, DASHQL_FOLDER)).isDirectory();
    } catch {
        return false;
    }
}

/// What a command says to a --workspace that is no workspace. It names no command that sets one up to the agent: an
/// agent that set up the folder of a wrong path would run it outside the tab.
export function noWorkspace(name: string): string {
    return `${name} is no workspace of DashQL, it has no ${DASHQL_FOLDER}/. Pass the workspace that the start of the session of dashql connect names. Only the user sets up a workspace.`;
}

/// The session of `dashql connect` that runs in a workspace, from the file of the session at its fixed path. Null when
/// none runs there.
export function readSession(workspace: string): SessionFile | null {
    try {
        return parseSessionFile(readFileSync(path.join(sessionFolder(workspace), SESSION_FILE), 'utf8'));
    } catch {
        return null;
    }
}

/// The folder of the files of DashQL of a command, with the layout of the storage of the app: --home, else the
/// `.dashql/` of the workspace
export function dashqlRoot(workspace: string, home: string | null): string {
    return home ?? path.join(workspace, DASHQL_FOLDER);
}

/// The id of the workbook of a folder that the tab copied into the session of a workspace, null for another folder
export function copiedWorkbookId(workspace: string, folder: string): string | null {
    const id = path.basename(folder);
    return isWorkbookCopyId(id) && path.resolve(workspace, workbookCopyPath(id)) === path.resolve(folder) ? id : null;
}

/// Is a folder the copy of a workbook of a tab in some workspace, `<workspace>/.dashql/session/workbooks/<workbook id>`?
/// Read from the path: a copy runs only with the workspace of its session.
export function isWorkbookCopyFolder(folder: string): boolean {
    const up = (levels: number) => path.basename(path.resolve(folder, ...Array<string>(levels).fill('..')));
    return up(1) === SESSION_WORKBOOK_COPIES && up(2) === SESSION_FOLDER && up(3) === DASHQL_FOLDER;
}

/// The connections that the tab of the session of a workspace lets the agent use, null without a session and before the
/// tab told them
export function readSessionConnections(workspace: string): SessionConnections | null {
    try {
        return parseSessionConnections(readFileSync(path.join(sessionFolder(workspace), SESSION_CONNECTIONS_FILE), 'utf8'));
    } catch {
        return null;
    }
}
