// The journal of a session (docs/wip/agent_session.md). `dashql session serve` creates `.dashql/journal.jsonl` in the
// folder of the session, and dashql commands below it append their log records to it, one JSON line each. Records of
// the target `workbook_journal` are markers that tell what changed: the files of a workbook folder. The server folds
// the markers into the workbooks of the session and keeps the latest other records as the log of the commands; the
// page fetches the files that it lacks.
import type { LogKeyValues, LogRecord, LogValue } from '../logger/log_buffer.js';

/// The folder of the journal in the folder of a session
export const SESSION_JOURNAL_FOLDER = '.dashql';
/// The journal in that folder
export const SESSION_JOURNAL_FILE = 'journal.jsonl';
/// The folder of the sessions of `dashql connect` in that folder, one folder per session with its own journal
export const SESSION_JOURNAL_SESSIONS = 'sessions';

/// The file of the connections that the tab lets the agent use, in the folder of a session of `dashql connect`
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

/// The folder of the copies of the workbooks of pages in that folder, `.dashql/workbooks/<workbook id>/`: a page that
/// connects writes its workbook there for the agent
export const SESSION_WORKBOOK_COPIES = 'workbooks';

/// The name of a session of `dashql connect`, a folder name: letters, digits, `-` and `_`
export function isSessionName(name: string): boolean {
    return /^[\w-]{1,64}$/.test(name);
}

/// The id of a workbook that a page copies, a folder name like the name of a session
export const isWorkbookCopyId = isSessionName;

/// The folder of the copy of a workbook relative to the folder of the session, as the markers of the journal name it
export function workbookCopyPath(workbookId: string): string {
    return `${SESSION_JOURNAL_FOLDER}/${SESSION_WORKBOOK_COPIES}/${workbookId}`;
}

/// The path of the journal of a session in the folder of the journal: `sessions/<name>/journal.jsonl` for a session of
/// `dashql connect`, `journal.jsonl` for the one of `dashql session serve`
export function sessionJournalPath(session: string | null): string[] {
    if (session == null) return [SESSION_JOURNAL_FILE];
    if (!isSessionName(session)) throw new Error(`invalid session name ${JSON.stringify(session)}`);
    return [SESSION_JOURNAL_SESSIONS, session, SESSION_JOURNAL_FILE];
}
/// The target of the records that tell what changed
export const JOURNAL_TARGET = 'workbook_journal';

/// The message of the marker of the files of a workbook folder
export const JOURNAL_FILES = 'Workbook files';

/// The keys of the markers. Every marker names its workbook folder relative to the folder of the session (`.` for the
/// folder itself) and the id of its workbook.
export const JOURNAL_KEYS = {
    workbook: 'workbook',
    workbookId: 'workbook_id',
    /// The paths of all files of the folder (Workbook files)
    files: 'files',
} as const;

/// A file of a workbook folder with its stamp, which the server reads when it folds the marker
export interface JournalFile {
    /// The path in the workbook folder, with forward slashes
    path: string;
    size: number;
    mtimeMs: number;
}

/// A workbook folder of a session as its journal leaves it
export interface SessionWorkbook {
    /// The folder relative to the folder of the session
    path: string;
    workbookId: string;
    /// The files of the folder, as the latest command saw them
    files: JournalFile[];
}

/// The workbook folder of a marker: its path relative to the folder of the session and the id of its workbook
export interface JournalWorkbookRef {
    workbook: string;
    workbookId: string;
}

/// A marker of the journal, a command logs it with the target JOURNAL_TARGET
export interface JournalMarker {
    message: string;
    keyValues: LogKeyValues;
}

function markerOf(message: string, ref: JournalWorkbookRef, keyValues: LogKeyValues): JournalMarker {
    return { message, keyValues: { [JOURNAL_KEYS.workbook]: ref.workbook, [JOURNAL_KEYS.workbookId]: ref.workbookId, ...keyValues } };
}

/// The marker of all files of a workbook folder
export function journalFilesMarker(ref: JournalWorkbookRef, files: readonly string[]): JournalMarker {
    return markerOf(JOURNAL_FILES, ref, { [JOURNAL_KEYS.files]: files });
}

/// Parse lines of the journal, the lines that are no records are skipped
export function parseJournalLines(text: string): LogRecord[] {
    const records: LogRecord[] = [];
    for (const line of text.split('\n')) {
        if (line.trim().length === 0) continue;
        try {
            const record = JSON.parse(line) as LogRecord;
            if (typeof record.message === 'string' && typeof record.target === 'string' && record.keyValues != null && typeof record.keyValues === 'object') {
                records.push(record);
            }
        } catch {
            // A torn write or a line of another version
        }
    }
    return records;
}

function textOf(value: LogValue): string | null {
    return typeof value === 'string' ? value : null;
}

/// Is a record a marker of the journal?
export function isJournalMarker(record: LogRecord): boolean {
    return record.target === JOURNAL_TARGET;
}

/// The paths of the files of a Workbook files marker, null for other records
export function journalFilePaths(record: LogRecord): string[] | null {
    if (!isJournalMarker(record) || record.message !== JOURNAL_FILES) return null;
    const files = record.keyValues[JOURNAL_KEYS.files];
    return Array.isArray(files) ? files.filter(file => typeof file === 'string') : [];
}

/// Apply a marker to the workbooks of a session. The files of a Workbook files marker come with their stamps, which the
/// caller read. Other records leave the workbooks as they are.
export function reduceJournalMarker(workbooks: readonly SessionWorkbook[], record: LogRecord, files: JournalFile[] = []): SessionWorkbook[] {
    if (!isJournalMarker(record) || record.message !== JOURNAL_FILES) return [...workbooks];
    const path = textOf(record.keyValues[JOURNAL_KEYS.workbook]);
    const workbookId = textOf(record.keyValues[JOURNAL_KEYS.workbookId]);
    if (path == null || workbookId == null) return [...workbooks];
    // A folder that now holds another workbook takes its place
    const index = workbooks.findIndex(workbook => workbook.path === path);
    const next: SessionWorkbook = { path, workbookId, files };
    return index >= 0 ? [...workbooks.slice(0, index), next, ...workbooks.slice(index + 1)] : [...workbooks, next];
}
