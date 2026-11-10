import { isAttachmentFileName, type WorkbookAttachment, type WorkbookConnection, type WorkbookData, type WorkbookScript } from './storage_backend.js';
import { isValidUuid } from './workbook_validation.js';

/// The draft script of the editor, never a script of a workbook
const DRAFT_SCRIPT_FILE = 'dashql-draft.sql';
/// The maximum number of scripts and the maximum number of attachments of a workbook
export const MAX_WORKBOOK_FILES = 2048;

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/// Compare file names in natural order ("2_a.sql" before "10_a.sql")
export function compareFileNamesNaturally(a: string, b: string): number {
    return NATURAL_SORT.compare(a, b);
}

/// Is the value a plain file name that can't escape its folder?
export function isSafeFileName(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= 255
        && value !== '.'
        && value !== '..'
        && !value.includes('/')
        && !value.includes('\\')
        && !value.includes('\0');
}

/// The key under which two file names denote the same file on a case-insensitive file system
function fileNameKey(name: string): string {
    return name.normalize('NFC').toLowerCase();
}

/// Is the value the name of a script file?
function isScriptFileName(value: unknown): value is string {
    return isSafeFileName(value)
        && value.toLowerCase().endsWith('.sql')
        && fileNameKey(value) !== DRAFT_SCRIPT_FILE;
}

/// The file lists of a workbook after the unusable entries were removed
export interface SanitizedWorkbookFiles {
    /// The scripts in feed order
    scripts: WorkbookScript[];
    /// The attachments in natural order
    attachments: WorkbookAttachment[];
    /// False when entries were removed
    valid: boolean;
}

/// Remove the entries of the file lists that can't be used: names that are not plain file names,
/// scripts without a valid connection id, duplicates and entries beyond the limit.
///
/// The lists of a workbook file are edited by hand, a bad entry therefore does not reject the workbook.
export function sanitizeWorkbookFiles(workbook: WorkbookData): SanitizedWorkbookFiles {
    let valid = true;
    const scripts: WorkbookScript[] = [];
    const scriptKeys = new Set<string>();
    const rawScripts: unknown = (workbook as { scripts?: unknown }).scripts;
    if (!Array.isArray(rawScripts)) valid = false;
    for (const script of Array.isArray(rawScripts) ? rawScripts : []) {
        if (scripts.length >= MAX_WORKBOOK_FILES) {
            valid = false;
            break;
        }
        if (!isPlainObject(script) || !isScriptFileName(script.name)
            || typeof script.connectionId !== 'string' || !isValidUuid(script.connectionId)
            || scriptKeys.has(fileNameKey(script.name))) {
            valid = false;
            continue;
        }
        scriptKeys.add(fileNameKey(script.name));
        scripts.push({ name: script.name.normalize('NFC'), connectionId: script.connectionId });
    }
    const attachmentNames: string[] = [];
    const attachmentKeys = new Set<string>();
    const rawAttachments: unknown = (workbook as { attachments?: unknown }).attachments;
    if (!Array.isArray(rawAttachments)) valid = false;
    for (const attachment of Array.isArray(rawAttachments) ? rawAttachments : []) {
        if (attachmentNames.length >= MAX_WORKBOOK_FILES) {
            valid = false;
            break;
        }
        // A workbook attaches Parquet files only
        if (!isPlainObject(attachment) || !isSafeFileName(attachment.name) || !isAttachmentFileName(attachment.name)
            || attachmentKeys.has(fileNameKey(attachment.name))) {
            valid = false;
            continue;
        }
        attachmentKeys.add(fileNameKey(attachment.name));
        attachmentNames.push(attachment.name.normalize('NFC'));
    }
    return { scripts, attachments: workbookAttachments(attachmentNames), valid };
}

/// The scripts of a workbook reconciled with the script files
export interface ReconciledWorkbookScripts {
    /// The scripts in feed order, one entry per file
    scripts: WorkbookScript[];
    /// Did the reconciliation change the scripts?
    changed: boolean;
}

/// Reconcile the scripts of a workbook with the script files that exist.
///
/// Entries keep their order. An entry without a file is dropped, the first of several entries for
/// a file wins and an entry that names a file with a different case or normalization takes the name
/// of the file. Files without an entry are appended in natural order, they run on the connection of
/// the script before them or, without scripts, on the given connection.
export function reconcileWorkbookScripts(
    scripts: readonly WorkbookScript[],
    fileNames: readonly string[],
    fallbackConnectionId: string,
): ReconciledWorkbookScripts {
    const filesByName = new Set(fileNames);
    const filesByKey = new Map<string, string>();
    for (const name of fileNames) {
        if (!filesByKey.has(fileNameKey(name))) filesByKey.set(fileNameKey(name), name);
    }
    const listed = new Set<string>();
    const result: WorkbookScript[] = [];
    let changed = false;
    for (const script of scripts) {
        const name = filesByName.has(script.name) ? script.name : filesByKey.get(fileNameKey(script.name));
        if (name == null || listed.has(name)) {
            changed = true;
            continue;
        }
        if (name !== script.name) changed = true;
        listed.add(name);
        result.push({ name, connectionId: script.connectionId });
    }
    const unlisted = fileNames.filter(name => !listed.has(name)).sort(compareFileNamesNaturally);
    for (const name of unlisted) {
        listed.add(name);
        result.push({ name, connectionId: result[result.length - 1]?.connectionId ?? fallbackConnectionId });
        changed = true;
    }
    return { scripts: result, changed };
}

/// The attachment list of a workbook for the given file names, in natural order
export function workbookAttachments(fileNames: readonly string[]): WorkbookAttachment[] {
    return [...fileNames].sort(compareFileNamesNaturally).map(name => ({ name }));
}

/// The ids of the connections that a workbook uses: the connections of its scripts in the order the
/// scripts first use them. A workbook without scripts uses the connection its first script will run on.
export function workbookConnectionIdsOf(scripts: readonly WorkbookScript[], emptyConnectionId: string | null = null): string[] {
    if (scripts.length === 0) return emptyConnectionId == null ? [] : [emptyConnectionId];
    return [...new Set(scripts.map(script => script.connectionId))];
}

/// The connection that the first script of a workbook without scripts runs on
export function workbookEmptyConnectionId(workbook: WorkbookData): string | null {
    return workbook.scripts.length === 0 ? workbook.connections[0]?.connectionId ?? null : null;
}

/// The workbook with a new script list.
///
/// The connections of a workbook are derived from its scripts: the workbook holds a copy of every
/// connection that a script uses, nothing else. A copy that the workbook holds wins over a given one,
/// saving a connection patches the copies of the workbooks that use it. A connection without any copy
/// is left out, the loader then runs its scripts on the embedded database.
///
/// A workbook without scripts keeps one connection, the one its first script will run on: the first
/// given copy, or the first connection the workbook held.
export function withWorkbookScripts(workbook: WorkbookData, scripts: WorkbookScript[], copies: readonly WorkbookConnection[] = []): WorkbookData {
    const known = new Map<string, WorkbookConnection>();
    for (const copy of [...workbook.connections, ...copies]) {
        if (!known.has(copy.connectionId)) known.set(copy.connectionId, copy);
    }
    const emptyConnectionId = copies[0]?.connectionId ?? workbook.connections[0]?.connectionId ?? null;
    const connections = workbookConnectionIdsOf(scripts, emptyConnectionId)
        .flatMap(connectionId => known.get(connectionId) ?? []);
    return { ...workbook, connections, scripts };
}

/// Replace the connection ids of the scripts, ids without a replacement are kept
export function remapWorkbookScripts(scripts: readonly WorkbookScript[], connectionIds: ReadonlyMap<string, string>): WorkbookScript[] {
    return scripts.map(script => ({ ...script, connectionId: connectionIds.get(script.connectionId) ?? script.connectionId }));
}

/// Do two script lists hold the same scripts in the same order?
export function workbookScriptsEqual(a: readonly WorkbookScript[], b: readonly WorkbookScript[]): boolean {
    return a.length === b.length && a.every((script, i) => script.name === b[i].name && script.connectionId === b[i].connectionId);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}
