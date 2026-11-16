import type * as core from '../../../core/index.js';

import { ATTACHMENT_EXTENSION, isAttachmentFileName } from '../../storage/storage_backend.js';

/// The directory that the embedded Hyper mounts the attachments of the workbooks in, one folder per workbook
export const ATTACHMENT_MOUNT_ROOT = '/mnt/external/attachments';

/// An attachment of a workbook as the view of the workbook lists it, a Parquet file in the `attachments` folder of the
/// workbook. It is the table parameter of its name, `sales.parquet` is `:sales` (docs/design/script_references.md). The
/// runtime names, writes and lists the attachments (`attachFiles`, `refreshAttachments`).
export type WorkbookAttachment = Pick<core.WorkbookAttachmentView, 'fileName' | 'name'>;

/// The name of the table parameter of an attachment, the file name without `.parquet`. Null for a file that is no
/// attachment.
export function attachmentParameterName(fileName: string): string | null {
    return isAttachmentFileName(fileName) ? fileName.slice(0, -ATTACHMENT_EXTENSION.length) : null;
}

/// The file name of a renamed attachment: the requested name with `.parquet` unless it has it, past the names of the
/// scripts and the other attachments like a new attachment. Null for a name that is no plain file name.
export function renamedAttachmentFileName(
    fileName: string,
    requested: string,
    scriptNames: Iterable<string>,
    attachments: readonly WorkbookAttachment[],
): string | null {
    const trimmed = requested.trim();
    const name = isAttachmentFileName(trimmed) ? trimmed : `${trimmed}${ATTACHMENT_EXTENSION}`;
    if (!isAttachmentFileName(name) || /[/\\\0]/.test(name)) return null;
    return freeAttachmentFileName(name, scriptNames, attachments.filter(attachment => attachment.fileName !== fileName));
}

/// A file name whose table parameter takes no name of a script or another attachment in any case, suffixing "-2",
/// "-3", ... to the name, like the runtime names a new attachment
function freeAttachmentFileName(fileName: string, scriptNames: Iterable<string>, attachments: readonly WorkbookAttachment[]): string {
    const base = attachmentParameterName(fileName) ?? fileName;
    const extension = fileName.slice(base.length);
    const taken = new Set([...scriptNames, ...attachments.map(attachment => attachment.name)].map(name => name.toLowerCase()));
    let candidate = base;
    for (let suffix = 2; taken.has(candidate.toLowerCase()); ++suffix) {
        candidate = `${base}-${suffix}`;
    }
    return `${candidate}${extension}`;
}

/// The directory that the embedded Hyper mounts the attachments of a workbook in
export function attachmentPrefix(workbookId: string): string {
    return `${ATTACHMENT_MOUNT_ROOT}/${workbookId}`;
}

/// The path of an attachment that the embedded Hyper reads
export function attachmentPath(workbookId: string, fileName: string): string {
    return `${attachmentPrefix(workbookId)}/${fileName}`;
}
