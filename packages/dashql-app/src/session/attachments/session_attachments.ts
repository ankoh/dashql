import type * as core from '@ankoh/dashql-core';

import { ATTACHMENT_EXTENSION, isAttachmentFileName, type DataFile } from '../../storage/storage_backend.js';

/// The directory that the embedded Hyper mounts the attachments of the sessions in, one folder per session
export const ATTACHMENT_MOUNT_ROOT = '/mnt/external/attachments';

/// An attachment of a session, a Parquet file in the `attachments` folder of the session. It is the table parameter of
/// its name, `sales.parquet` is `:sales` (docs/design/script_references.md).
export interface SessionAttachment {
    /// The file name
    fileName: string;
    /// The name of the table parameter, the file name without `.parquet`
    name: string;
    /// The size of the file
    sizeBytes: number;
    /// The time of the last modification, 0 if the storage doesn't know it
    mtimeMs: number;
    /// The columns of the file, null until they were read
    columns: string[] | null;
}

/// The name of the table parameter of an attachment, the file name without `.parquet`. Null for a file that is no
/// attachment.
export function attachmentParameterName(fileName: string): string | null {
    return isAttachmentFileName(fileName) ? fileName.slice(0, -ATTACHMENT_EXTENSION.length) : null;
}

/// The names of the table parameters of attachments, which no script may take
export function attachmentNames(attachments: readonly SessionAttachment[] | undefined): string[] {
    return (attachments ?? []).map(attachment => attachment.name);
}

/// A file name for a new attachment whose table parameter takes no name of a script or another attachment, the
/// same name in another case neither: `sales.parquet` becomes `sales-2.parquet`. A file with the name of an attachment
/// replaces it and keeps its name.
export function uniqueAttachmentFileName(fileName: string, scriptNames: Iterable<string>, attachments: readonly SessionAttachment[]): string {
    if (attachments.some(attachment => attachment.fileName === fileName)) return fileName;
    return freeAttachmentFileName(fileName, scriptNames, attachments);
}

/// The file name of a renamed attachment: the requested name with `.parquet` unless it has it, past the names of the
/// scripts and the other attachments like a new attachment. Null for a name that is no plain file name.
export function renamedAttachmentFileName(
    fileName: string,
    requested: string,
    scriptNames: Iterable<string>,
    attachments: readonly SessionAttachment[],
): string | null {
    const trimmed = requested.trim();
    const name = isAttachmentFileName(trimmed) ? trimmed : `${trimmed}${ATTACHMENT_EXTENSION}`;
    if (!isAttachmentFileName(name) || /[/\\\0]/.test(name)) return null;
    return freeAttachmentFileName(name, scriptNames, attachments.filter(attachment => attachment.fileName !== fileName));
}

/// A file name whose table parameter takes no name of a script or another attachment in any case, suffixing "-2",
/// "-3", ... to the name
function freeAttachmentFileName(fileName: string, scriptNames: Iterable<string>, attachments: readonly SessionAttachment[]): string {
    const base = attachmentParameterName(fileName) ?? fileName;
    const extension = fileName.slice(base.length);
    const taken = new Set([...scriptNames, ...attachmentNames(attachments)].map(name => name.toLowerCase()));
    let candidate = base;
    for (let suffix = 2; taken.has(candidate.toLowerCase()); ++suffix) {
        candidate = `${base}-${suffix}`;
    }
    return `${candidate}${extension}`;
}

/// What changes when the file of an attachment changes
export function attachmentStamp(attachment: SessionAttachment): string {
    return `${attachment.sizeBytes}-${attachment.mtimeMs}`;
}

/// The attachments of a listing of the data files of a session, other files are no attachments. An attachment whose
/// file is unchanged keeps the columns of `previous`.
export function readSessionAttachments(files: readonly DataFile[], previous: readonly SessionAttachment[] = []): SessionAttachment[] {
    const before = new Map(previous.map(attachment => [attachment.fileName, attachment]));
    return files.flatMap(file => {
        const name = attachmentParameterName(file.name);
        if (name == null) return [];
        const attachment: SessionAttachment = {
            fileName: file.name,
            name,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs ?? 0,
            columns: null,
        };
        const kept = before.get(file.name);
        if (kept != null && attachmentStamp(kept) === attachmentStamp(attachment)) attachment.columns = kept.columns;
        return [attachment];
    });
}

/// Do two lists hold the same attachments?
export function sameSessionAttachments(l: readonly SessionAttachment[], r: readonly SessionAttachment[]): boolean {
    return l.length === r.length && l.every((a, i) => {
        const b = r[i];
        return a.fileName === b.fileName && attachmentStamp(a) === attachmentStamp(b)
            && (a.columns ?? []).join('\u0001') === (b.columns ?? []).join('\u0001') && (a.columns == null) === (b.columns == null);
    });
}

/// The directory that the embedded Hyper mounts the attachments of a session in
export function attachmentPrefix(sessionId: string): string {
    return `${ATTACHMENT_MOUNT_ROOT}/${sessionId}`;
}

/// The path of an attachment that the embedded Hyper reads
export function attachmentPath(sessionId: string, fileName: string): string {
    return `${attachmentPrefix(sessionId)}/${fileName}`;
}

/// The attachments of a session that table parameters read, for a request of the core
export function planAttachments(attachments: readonly SessionAttachment[] | undefined): core.SessionPlanAttachment[] {
    return (attachments ?? []).map(attachment => ({
        name: attachment.name,
        file: attachment.fileName,
        stamp: attachmentStamp(attachment),
        columns: attachment.columns,
    }));
}
