// The journal of the session of a workspace (@akohn/dashql/platform/session/workbook_journal): dashql
// commands append their log records, `dashql session serve` reads them.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import {
    isSessionName,
    parseSessionConnections,
    sessionJournalPath,
    SESSION_CONNECTIONS_FILE,
    SESSION_JOURNAL_FOLDER,
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

/// The variable that names the session of `dashql connect` for the commands of its harness. It holds no secret: Codex
/// passes it to the commands of its agent.
export const SESSION_NAME_ENV = 'DASHQL_SESSION';

/// The variable that names the folder of the session of `dashql connect` for the commands of its harness and its hooks:
/// their workspace. The agent may change the directory of its shell, e.g. into a workbook folder; the commands still
/// find the copies of the tab, the journal and the server of the session.
export const SESSION_WORKSPACE_ENV = 'DASHQL_WORKSPACE';

/// The journal of the session of a workspace, which the server of the session creates in its folder:
/// `.dashql/sessions/<session>/journal.jsonl` for a session of `dashql connect`, `.dashql/journal.jsonl` for one of
/// `dashql session serve`. Null outside a session and for a workbook folder outside the workspace: the server hands
/// out only the files of its folder.
export function openSessionJournal(workspace: string, workbookFolder: string, session: string | null = null): SessionJournal | null {
    const name = session != null && isSessionName(session) ? session : null;
    const journal = path.join(workspace, SESSION_JOURNAL_FOLDER, ...sessionJournalPath(name));
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
    const file = path.join(workspace, SESSION_JOURNAL_FOLDER, ...sessionJournalPath(session).slice(0, -1), SESSION_CONNECTIONS_FILE);
    try {
        return parseSessionConnections(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/// The server of a session of `dashql connect`: from DASHQL_SESSION_ENDPOINT and DASHQL_SESSION_TOKEN, else from the
/// folder of the session. Null outside such a session.
export function readSessionServer(workspace: string, session: string | null, env: { endpoint?: string; token?: string } = {}): { endpoint: string; token: string } | null {
    if (env.endpoint && env.token) return { endpoint: env.endpoint, token: env.token };
    if (session == null || !isSessionName(session)) return null;
    try {
        const file = path.join(workspace, SESSION_JOURNAL_FOLDER, ...sessionJournalPath(session).slice(0, -1), SESSION_SERVER_FILE);
        const value = JSON.parse(readFileSync(file, 'utf8')) as { endpoint?: unknown; token?: unknown };
        return typeof value.endpoint === 'string' && typeof value.token === 'string' ? { endpoint: value.endpoint, token: value.token } : null;
    } catch {
        return null;
    }
}
