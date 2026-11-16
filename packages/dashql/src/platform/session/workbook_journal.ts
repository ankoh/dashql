// The journal of a session (docs/wip/agent_session.md). `dashql session serve` creates `.dashql/journal.jsonl` in the
// folder of the session, and dashql commands below it append their log records to it, one JSON line each. Records of
// the target `workbook_journal` are markers that tell what changed: the files of a workbook folder, a script that
// started, its progress and its result. The server folds the markers into the workbooks of the session and keeps the
// latest other records as the log of the commands; the page fetches the files and the results that it lacks.
import type { LogKeyValues, LogRecord, LogValue } from '../platform/logger/log_buffer.js';

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

/// The messages of the markers
export const JOURNAL_FILES = 'Workbook files';
export const JOURNAL_SCRIPT_STARTED = 'Script started';
export const JOURNAL_SCRIPT_PROGRESS = 'Script progress';
export const JOURNAL_SCRIPT_RESULT = 'Script result';

/// The keys of the markers. Every marker names its workbook folder relative to the folder of the session (`.` for the
/// folder itself) and the id of its workbook.
export const JOURNAL_KEYS = {
    workbook: 'workbook',
    workbookId: 'workbook_id',
    /// The paths of all files of the folder (Workbook files)
    files: 'files',
    /// The file name of the script (Script started, Script progress, Script result)
    script: 'script',
    /// The phase of the query, its progress in percent and the rows it processed (Script progress)
    phase: 'phase',
    percent: 'percent',
    rows: 'rows',
    /// The key of the result in the query result cache, empty if it is not cached (Script result)
    key: 'key',
    /// The rows of the result (Script result)
    resultRows: 'result_rows',
    /// Why the script failed (Script result)
    error: 'error',
    /// `true` if the cache served the result (Script result)
    cached: 'cached',
} as const;

/// A file of a workbook folder with its stamp, which the server reads when it folds the marker
export interface JournalFile {
    /// The path in the workbook folder, with forward slashes
    path: string;
    size: number;
    mtimeMs: number;
}

/// The result of a script that a command ran
export interface JournalResult {
    script: string;
    /// The key of the result in the query result cache, null if it is not cached
    key: string | null;
    /// The rows of the result, null without a result
    rows: number | null;
    /// Why the script failed, null if it ran
    error: string | null;
    /// Did the cache serve the result instead of the connection?
    cached: boolean;
}

/// A script that runs right now
export interface JournalRunningScript {
    script: string;
    /// The phase of its query, e.g. RUNNING of Trino, null before the first progress
    phase: string | null;
    percent: number | null;
    rows: number | null;
}

/// A workbook folder of a session as its journal leaves it
export interface SessionWorkbook {
    /// The folder relative to the folder of the session
    path: string;
    workbookId: string;
    /// The files of the folder, as the latest command saw them
    files: JournalFile[];
    /// The latest result of every script that ran, in the order of their runs
    results: JournalResult[];
    /// The script that runs, null if none does
    running: JournalRunningScript | null;
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

const textOfNumber = (value: number | null) => value == null ? '' : String(value);

/// The marker of all files of a workbook folder
export function journalFilesMarker(ref: JournalWorkbookRef, files: readonly string[]): JournalMarker {
    return markerOf(JOURNAL_FILES, ref, { [JOURNAL_KEYS.files]: files });
}

/// The marker of a script that starts
export function journalScriptStartedMarker(ref: JournalWorkbookRef, script: string): JournalMarker {
    return markerOf(JOURNAL_SCRIPT_STARTED, ref, { [JOURNAL_KEYS.script]: script });
}

/// The marker of the progress of a script that runs
export function journalScriptProgressMarker(ref: JournalWorkbookRef, running: JournalRunningScript): JournalMarker {
    return markerOf(JOURNAL_SCRIPT_PROGRESS, ref, {
        [JOURNAL_KEYS.script]: running.script,
        [JOURNAL_KEYS.phase]: running.phase ?? '',
        [JOURNAL_KEYS.percent]: textOfNumber(running.percent == null ? null : Math.round(running.percent)),
        [JOURNAL_KEYS.rows]: textOfNumber(running.rows),
    });
}

/// The marker of the result of a script
export function journalScriptResultMarker(ref: JournalWorkbookRef, result: JournalResult): JournalMarker {
    return markerOf(JOURNAL_SCRIPT_RESULT, ref, {
        [JOURNAL_KEYS.script]: result.script,
        [JOURNAL_KEYS.key]: result.key ?? '',
        [JOURNAL_KEYS.resultRows]: textOfNumber(result.rows),
        [JOURNAL_KEYS.error]: result.error ?? '',
        [JOURNAL_KEYS.cached]: String(result.cached),
    });
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

function numberOf(value: LogValue): number | null {
    const text = textOf(value);
    if (text == null || text.length === 0) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
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
    if (!isJournalMarker(record)) return [...workbooks];
    const path = textOf(record.keyValues[JOURNAL_KEYS.workbook]);
    const workbookId = textOf(record.keyValues[JOURNAL_KEYS.workbookId]);
    if (path == null || workbookId == null) return [...workbooks];
    const index = workbooks.findIndex(workbook => workbook.path === path);
    const previous = index >= 0 ? workbooks[index] : null;
    // A folder that now holds another workbook starts over
    let next: SessionWorkbook = previous != null && previous.workbookId === workbookId
        ? previous
        : { path, workbookId, files: [], results: [], running: null };
    const script = textOf(record.keyValues[JOURNAL_KEYS.script]);
    switch (record.message) {
        case JOURNAL_FILES:
            next = { ...next, files };
            break;
        case JOURNAL_SCRIPT_STARTED:
            if (script != null) next = { ...next, running: { script, phase: null, percent: null, rows: null } };
            break;
        case JOURNAL_SCRIPT_PROGRESS:
            if (script != null) next = {
                ...next,
                running: {
                    script,
                    phase: textOf(record.keyValues[JOURNAL_KEYS.phase]),
                    percent: numberOf(record.keyValues[JOURNAL_KEYS.percent]),
                    rows: numberOf(record.keyValues[JOURNAL_KEYS.rows]),
                },
            };
            break;
        case JOURNAL_SCRIPT_RESULT: {
            if (script == null) break;
            const error = textOf(record.keyValues[JOURNAL_KEYS.error]);
            const result: JournalResult = {
                script,
                key: textOf(record.keyValues[JOURNAL_KEYS.key]) || null,
                rows: numberOf(record.keyValues[JOURNAL_KEYS.resultRows]),
                error: error || null,
                cached: record.keyValues[JOURNAL_KEYS.cached] === 'true',
            };
            next = {
                ...next,
                results: [...next.results.filter(other => other.script !== script), result],
                running: next.running?.script === script ? null : next.running,
            };
            break;
        }
        default:
            return [...workbooks];
    }
    return index >= 0 ? [...workbooks.slice(0, index), next, ...workbooks.slice(index + 1)] : [...workbooks, next];
}
