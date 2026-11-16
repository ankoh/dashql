/// The attachments of a workbook are Parquet files in its `attachments` folder, the table parameters of their names:
/// `sales.parquet` is `:sales` (docs/design/script_references.md). The runtime names, writes, renames and lists them
/// (`attachFiles`, `renameAttachment`, `refreshAttachments`), the view of the workbook lists them.

/// The directory that the embedded Hyper mounts the attachments of the workbooks in, one folder per workbook
export const ATTACHMENT_MOUNT_ROOT = '/mnt/external/attachments';

/// The directory that the embedded Hyper mounts the attachments of a workbook in
export function attachmentPrefix(workbookId: string): string {
    return `${ATTACHMENT_MOUNT_ROOT}/${workbookId}`;
}

/// The path of an attachment that the embedded Hyper reads
export function attachmentPath(workbookId: string, fileName: string): string {
    return `${attachmentPrefix(workbookId)}/${fileName}`;
}
