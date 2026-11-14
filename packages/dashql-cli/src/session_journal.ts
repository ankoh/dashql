// The journal of the session that a workbook folder is in (@ankoh/dashql-runtime/session/workbook_journal): dashql
// commands append their log records, `dashql session serve` reads them.
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import type { LogRecord } from '@ankoh/dashql-runtime/platform/logger/log_buffer';
import { SESSION_JOURNAL_FILE, SESSION_JOURNAL_FOLDER } from '@ankoh/dashql-runtime/session/workbook_journal';
import type { NativeStorageBackend } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@ankoh/dashql-runtime/storage/storage_backend';

/// The journal that a command of a workbook folder appends to
export interface SessionJournal {
    /// The workbook folder relative to the folder of the session, `.` for the folder itself
    readonly workbook: string;
    /// Append a record, a journal that can't be written is skipped: the command never fails for it
    write(record: LogRecord): void;
}

/// The journal of the session that a workbook folder is in: the nearest `.dashql/journal.jsonl` in the folder or above
/// it, which `dashql session serve` creates in the folder of its session. Null outside a session.
export function openSessionJournal(workbookFolder: string): SessionJournal | null {
    const folder = path.resolve(workbookFolder);
    let dir = folder;
    while (true) {
        const journal = path.join(dir, SESSION_JOURNAL_FOLDER, SESSION_JOURNAL_FILE);
        if (existsSync(journal)) {
            return {
                workbook: path.relative(dir, folder).split(path.sep).join('/') || '.',
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
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
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
