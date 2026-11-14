import { getOPFSRoot } from '../../platform/opfs_root.js';
import type { NativeStorageBackend } from '../../storage/native_storage_backend.js';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_WORKBOOKS_FOLDER, validateDataFileName } from '../../storage/storage_backend.js';

/// Mirror the attachments of a workbook folder into the root of the app, `workbooks/<id>/attachments`, where the
/// embedded Hyper reads them (`attachment_mounts.ts`). A file is copied unless the mirror has its size and is newer,
/// files that the folder no longer has are removed. Returns the names of the copied files.
export async function mirrorWorkbookAttachments(
    native: NativeStorageBackend,
    workbookId: string,
    getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot,
): Promise<string[]> {
    const files = (await native.stampFolder()).attachments;
    const workbooks = await (await getRoot()).getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create: true });
    const mirror = await (await workbooks.getDirectoryHandle(workbookId, { create: true }))
        .getDirectoryHandle(STORAGE_ATTACHMENTS_FOLDER, { create: true });
    const copied: string[] = [];
    const names = new Set<string>();
    for (const file of files) {
        validateDataFileName(file.name);
        names.add(file.name);
        let current: File | null = null;
        try {
            current = await (await mirror.getFileHandle(file.name)).getFile();
        } catch {
            // Not mirrored yet
        }
        if (current != null && current.size === file.size && current.lastModified >= file.mtimeMs) continue;
        const writable = await (await mirror.getFileHandle(file.name, { create: true })).createWritable();
        await writable.write(await native.loadDataFile(workbookId, file.name) as Uint8Array<ArrayBuffer>);
        await writable.close();
        copied.push(file.name);
    }
    for await (const [name, handle] of mirror.entries()) {
        if (handle.kind === 'file' && !names.has(name)) await mirror.removeEntry(name);
    }
    return copied;
}
