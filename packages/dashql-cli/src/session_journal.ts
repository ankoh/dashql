// The session of `dashql connect` that a command runs in, and its journal
// (@akohn/dashql/platform/session/workbook_journal): dashql commands append their log records, the server reads them.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import {
    isSessionName,
    parseSessionConnections,
    sessionJournalPath,
    SESSION_CONNECTIONS_FILE,
    SESSION_JOURNAL_FOLDER,
    SESSION_WORKBOOK_COPIES,
    type SessionConnections,
} from '@akohn/dashql/platform/session/workbook_journal';
import type { NativeStorageBackend } from '@akohn/dashql/platform/storage/native_storage_backend';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';

/// The journal that a command of a workbook folder appends to
export interface SessionJournal {
    /// The workbook folder relative to the folder of the session, `.` for the folder itself
    readonly workbook: string;
    /// Append a record, a journal that can't be written is skipped: the command never fails for it
    write(record: LogRecord): void;
}

/// The file with the address of the server in the folder of a session of `dashql connect`
export const SESSION_SERVER_FILE = 'server.json';

/// The folder of a session of `dashql connect` in its workspace, `.dashql/sessions/<session>/`
export function sessionFolder(workspace: string, session: string): string {
    return path.join(workspace, SESSION_JOURNAL_FOLDER, ...sessionJournalPath(session).slice(0, -1));
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
/// for the copy of a workbook of a tab (`<folder>/.dashql/workbooks/<id>`), which only a session runs.
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

/// Is a folder the copy of a workbook of a tab, `.dashql/workbooks/<id>` of a folder?
function isWorkbookCopyFolder(folder: string): boolean {
    const parent = path.dirname(folder);
    return path.basename(parent) === SESSION_WORKBOOK_COPIES && path.basename(path.dirname(parent)) === SESSION_JOURNAL_FOLDER;
}

/// The journal of a session of `dashql connect`, which its server creates in the folder of the session. Null outside a
/// session and for a workbook folder outside the workspace: the server hands out only the files of its folder.
export function openSessionJournal(workspace: string, workbookFolder: string, session: string | null): SessionJournal | null {
    if (session == null || !isSessionName(session)) return null;
    const journal = path.join(workspace, SESSION_JOURNAL_FOLDER, ...sessionJournalPath(session));
    const relative = path.relative(path.resolve(workspace), path.resolve(workbookFolder));
    if (!existsSync(journal) || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return {
        workbook: relative.split(path.sep).join('/') || '.',
        write: record => {
            try {
                // One write of a whole line, the appends of other commands never interleave with it
                appendFileSync(journal, `${JSON.stringify(record)}\n`);
            } catch {
                // The session is gone or its folder is not writable here
            }
        },
    };
}

/// The paths of all files of a workbook folder: its workbook file, its scripts and its attachments
export async function workbookFolderPaths(storage: NativeStorageBackend): Promise<string[]> {
    const stamps = await storage.stampFolder();
    return [
        STORAGE_WORKBOOK_FILE,
        ...stamps.scripts.map(file => `${STORAGE_SCRIPTS_FOLDER}/${file.name}`),
        ...stamps.attachments.map(file => `${STORAGE_ATTACHMENTS_FOLDER}/${file.name}`),
    ];
}

/// The connections that the tab of a session of `dashql connect` lets the agent use, null outside such a session and
/// before the tab told them: every connection then
export function readSessionConnections(workspace: string, session: string | null): SessionConnections | null {
    if (session == null || !isSessionName(session)) return null;
    try {
        return parseSessionConnections(readFileSync(path.join(sessionFolder(workspace, session), SESSION_CONNECTIONS_FILE), 'utf8'));
    } catch {
        return null;
    }
}

/// The server of a session of `dashql connect`, from the file that it writes into the folder of the session. Null
/// outside such a session.
export function readSessionServer(workspace: string, session: string | null): { endpoint: string; token: string } | null {
    if (session == null || !isSessionName(session)) return null;
    try {
        const value = JSON.parse(readFileSync(path.join(sessionFolder(workspace, session), SESSION_SERVER_FILE), 'utf8')) as { endpoint?: unknown; token?: unknown };
        return typeof value.endpoint === 'string' && typeof value.token === 'string' ? { endpoint: value.endpoint, token: value.token } : null;
    } catch {
        return null;
    }
}
