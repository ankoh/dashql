// The journal of the session of a workspace (@ankoh/dashql/platform/session/workbook_journal): dashql
// commands append their log records, `dashql session serve` reads them.
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import type { LogRecord } from '@ankoh/dashql/platform/platform/logger/log_buffer';
import { isSessionName, sessionJournalPath, SESSION_JOURNAL_FOLDER } from '@ankoh/dashql/platform/session/workbook_journal';
import type { NativeStorageBackend } from '@ankoh/dashql/platform/storage/native_storage_backend';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@ankoh/dashql/platform/storage/storage_backend';

/// The journal that a command of a workbook folder appends to
export interface SessionJournal {
    /// The workbook folder relative to the folder of the session, `.` for the folder itself
    readonly workbook: string;
    /// Append a record, a journal that can't be written is skipped: the command never fails for it
    write(record: LogRecord): void;
}

/// The variable that names the session of `dashql connect` for the commands of its harness. It holds no secret: Codex
/// passes it to the commands of its agent.
export const SESSION_NAME_ENV = 'DASHQL_SESSION';

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
