import type * as core from '../core/index.js';

import type { HandleTable } from './store/handles.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import type { AttachmentFiles, AttachmentMounts } from '../platform/workbook/attachment_mounts.js';

/// The attachments of the workbooks in the compute database, the `mounts` of the platform of the runtime.
///
/// The attachments of a workbook are mounted from its folder, and unmounted when the workbook is deleted. The stored
/// results of the scripts that the runs read and write are the `results` of the platform
/// (docs/design/workbook_results.md). The calls wait until the platform set the compute database up.

/// The files of the attachments of a workbook in memory by their handles, null for the folder of the workbook. The
/// handle table holds a file as a Blob or as its bytes.
function memoryFiles(handles: HandleTable, files: core.RuntimeMemoryFile[] | null): AttachmentFiles | null {
    if (files == null) return null;
    const blobs = new Map<string, Blob>();
    for (const { fileName, file } of files) {
        const content = handles.get<Blob | Uint8Array>(file);
        if (content == null) throw new Error(`The attachment ${fileName} is no longer in memory`);
        blobs.set(fileName, content instanceof Blob ? content : new Blob([content as Uint8Array<ArrayBuffer>]));
    }
    return blobs;
}

export function createRunMounts(database: () => Promise<EmbeddedComputeDatabase>, handles: HandleTable, attachments: AttachmentMounts): core.RuntimeMounts {
    return {
        attachments: async (workbookId, files) => {
            await attachments.mount(await database(), workbookId, memoryFiles(handles, files));
        },
        attachmentColumns: async (workbookId, fileName, files) => attachments.readColumns(await database(), workbookId, fileName, memoryFiles(handles, files)),
        dropAttachments: workbookId => attachments.unmount(workbookId),
    };
}
