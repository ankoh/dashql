import type { StorageBackend } from '@ankoh/dashql-sdk/storage/storage_backend';
import { RENAME_ATTACHMENT, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import type { ModifyWorkbookScripts } from '../scripts/workbook_scripts_registry.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import { scriptDisplayName } from '@ankoh/dashql-sdk/workbook/scripts/script_types';
import { markWorkbookAttachmentsChanged } from '@ankoh/dashql-sdk/workbook/attachments/attachment_mounts';
import { attachmentParameterName, renamedAttachmentFileName } from '@ankoh/dashql-sdk/workbook/attachments/workbook_attachments';

/// Rename an attachment like a script: the file moves, the scripts that read its table parameter read the new name
/// (`RENAME_ATTACHMENT`) and so does the draft. The name takes no name of a script or another attachment, `sales`
/// becomes `sales-2` then. Returns the new file name, null if the name is no plain file name or unchanged.
export async function renameAttachment(
    workbook: WorkbookScripts,
    modify: ModifyWorkbookScripts,
    backend: Pick<StorageBackend, 'renameDataFile'>,
    fileName: string,
    requested: string,
    renameDraft: RenameDraftReferences | null | undefined,
): Promise<string | null> {
    const attachments = workbook.attachments ?? [];
    if (!attachments.some(attachment => attachment.fileName === fileName)) return null;
    const scriptNames = workbook.scriptOrder.map(scriptDisplayName);
    const newFileName = renamedAttachmentFileName(fileName, requested, scriptNames, attachments);
    if (newFileName == null || newFileName === fileName) return null;
    // The scripts read the new name once the file has it
    await backend.renameDataFile(workbook.workbookId, fileName, newFileName);
    markWorkbookAttachmentsChanged(workbook.workbookId);
    await modify({ type: RENAME_ATTACHMENT, value: { fileName, newFileName } });
    const [from, to] = [attachmentParameterName(fileName), attachmentParameterName(newFileName)];
    if (from != null && to != null) renameDraft?.(from, to);
    return newFileName;
}
