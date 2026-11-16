import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { RenameDraftReferences } from './scripts/script_rename.js';

/// Rename an attachment like a script: the runtime names it, the scripts that read its table parameter read the new
/// name and the file moves (`renameAttachment` of the runtime), then the draft reads the new name too. The name takes
/// no name of a script or another attachment, `sales` becomes `sales-2` then. Returns the new file name, null if the
/// name is no plain file name or unchanged. Rejects if the runtime refuses the rename, nothing changed then.
export async function renameAttachment(
    runtime: Pick<Runtime, 'renameAttachment' | 'store'>,
    workbook: Pick<WorkbookScripts, 'workbookId' | 'attachments'>,
    fileName: string,
    requested: string,
    renameDraft: RenameDraftReferences | null | undefined,
): Promise<string | null> {
    const attachment = workbook.attachments?.find(attachment => attachment.fileName === fileName);
    if (attachment == null) return null;
    const newFileName = await runtime.renameAttachment(workbook.workbookId, fileName, requested);
    if (newFileName == null) return null;
    const renamed = runtime.store.get('workbook', workbook.workbookId)?.attachments?.find(attachment => attachment.fileName === newFileName);
    if (renamed != null) renameDraft?.(attachment.name, renamed.name);
    return newFileName;
}
