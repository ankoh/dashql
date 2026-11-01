import type * as core from '@ankoh/dashql-core';

import type { DataFile } from '../../storage/storage_backend.js';

/// The directory that the embedded Hyper mounts the attachments of the sessions in, one folder per session
export const ATTACHMENT_MOUNT_ROOT = '/mnt/external/attachments';

/// An attachment of a session, a file in the `attachments` folder of the session. A Parquet file is the table
/// parameter of its name, `sales.parquet` is `:sales` (docs/design/script_references.md).
export interface SessionAttachment {
    /// The file name
    fileName: string;
    /// The name of the table parameter, null for files that are no Parquet file
    name: string | null;
    /// The size of the file
    sizeBytes: number;
    /// The time of the last modification, 0 if the storage doesn't know it
    mtimeMs: number;
    /// The columns of the file, null until they were read
    columns: string[] | null;
}

/// The name of the table parameter of an attachment, the file name without `.parquet`. Null for other files.
export function attachmentParameterName(fileName: string): string | null {
    const match = /^(.+)\.parquet$/i.exec(fileName);
    return match == null ? null : match[1];
}

/// What changes when the file of an attachment changes
export function attachmentStamp(attachment: SessionAttachment): string {
    return `${attachment.sizeBytes}-${attachment.mtimeMs}`;
}

/// The attachments of a listing of the data files of a session. An attachment whose file is unchanged keeps the
/// columns of `previous`.
export function readSessionAttachments(files: readonly DataFile[], previous: readonly SessionAttachment[] = []): SessionAttachment[] {
    const before = new Map(previous.map(attachment => [attachment.fileName, attachment]));
    return files.map(file => {
        const attachment: SessionAttachment = {
            fileName: file.name,
            name: attachmentParameterName(file.name),
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs ?? 0,
            columns: null,
        };
        const kept = before.get(file.name);
        if (kept != null && attachmentStamp(kept) === attachmentStamp(attachment)) attachment.columns = kept.columns;
        return attachment;
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
    return (attachments ?? []).flatMap(attachment => attachment.name == null ? [] : [{
        name: attachment.name,
        file: attachment.fileName,
        stamp: attachmentStamp(attachment),
        columns: attachment.columns,
    }]);
}
