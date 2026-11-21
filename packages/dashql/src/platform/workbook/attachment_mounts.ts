import { getOPFSRoot } from '../opfs_root.js';
import type { EmbeddedComputeDatabase } from '../embedded_database.js';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_WORKBOOKS_FOLDER } from '../storage/storage_backend.js';
import { attachmentPath, attachmentPrefix } from './workbook_attachments.js';

/// The mounts of the attachments of the workbooks in the embedded Hyper.
///
/// The embedded Hyper reads the attachments of a workbook from the OPFS folder `workbooks/<id>/attachments` (a native
/// workbook mirrors its attachments there), mounted read-only at `/mnt/external/attachments/<id>`. A workbook of a
/// runtime without storage, e.g. an archive opened in an embed, keeps the files of its attachments in memory, they are
/// mounted at the same path as a memory directory, so the scripts read them alike. A workbook is mounted before a plan
/// scans its attachments. A change of the attachments marks a folder mount stale, the next use refreshes it, so the
/// database looks up the files it opened again; a memory mount is mounted again when its files change. Every runtime
/// keeps its own mounts (`AttachmentMounts`), and removes them when it is destroyed.
interface AttachmentMount {
    /// The database that mounted the folder
    database: EmbeddedComputeDatabase;
    /// The files of a memory mount, null for the folder
    files: AttachmentFiles | null;
    /// Did the attachments change since the mount or its last refresh?
    stale: boolean;
}

/// The files of the attachments of a workbook in memory by file name
export type AttachmentFiles = ReadonlyMap<string, Blob>;

/// Do two sources of attachments name the same files?
function sameFiles(left: AttachmentFiles | null, right: AttachmentFiles | null): boolean {
    if (left == null || right == null) return left === right;
    return left.size === right.size && [...left].every(([name, file]) => right.get(name) === file);
}

/// The mounts of the attachments of the workbooks of one runtime. Mounts and refreshes run one after the other.
export class AttachmentMounts {
    private readonly mounts = new Map<string, AttachmentMount>();
    private pending: Promise<unknown> = Promise.resolve();

    constructor(private readonly getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot) { }

    private serialize<T>(f: () => Promise<T>): Promise<T> {
        const next = this.pending.then(f, f);
        this.pending = next.catch(() => {});
        return next;
    }

    /// Mount the attachments of a workbook in a database, refresh the mount if they changed. The attachments are in
    /// the folder of the workbook (`files` null) or in memory. Returns the mount path.
    mount(database: EmbeddedComputeDatabase, workbookId: string, files: AttachmentFiles | null = null): Promise<string> {
        return this.serialize(async () => {
            const path = attachmentPrefix(workbookId);
            let mount = this.mounts.get(workbookId);
            if (mount != null && (mount.database !== database || !sameFiles(mount.files, files))) {
                await mount.database.removeExternalDirectory(path).catch(() => {});
                this.mounts.delete(workbookId);
                mount = undefined;
            }
            if (mount == null) {
                if (files == null) {
                    const workbooks = await (await this.getRoot()).getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create: true });
                    const workbook = await workbooks.getDirectoryHandle(workbookId, { create: true });
                    const folder = await workbook.getDirectoryHandle(STORAGE_ATTACHMENTS_FOLDER, { create: true });
                    await database.registerExternalDirectory(folder, path, 'read');
                } else {
                    await database.registerMemoryDirectory(Object.fromEntries(files), path);
                }
                this.mounts.set(workbookId, { database, files, stale: false });
            } else if (mount.stale && mount.files == null) {
                // Changes during the refresh mark the mount stale again
                mount.stale = false;
                try {
                    await database.refreshExternalDirectory(path);
                } catch (error) {
                    mount.stale = true;
                    throw error;
                }
            }
            return path;
        });
    }

    /// The attachments of a workbook changed, the next use of the mount refreshes it
    changed(workbookId: string): void {
        const mount = this.mounts.get(workbookId);
        if (mount != null) mount.stale = true;
    }

    /// Remove the mount of the attachments of a workbook
    unmount(workbookId: string): Promise<void> {
        return this.serialize(async () => {
            const mount = this.mounts.get(workbookId);
            if (mount == null) return;
            this.mounts.delete(workbookId);
            await mount.database.removeExternalDirectory(attachmentPrefix(workbookId)).catch(() => {});
        });
    }

    /// Remove every mount, e.g. when the runtime is destroyed
    async unmountAll(): Promise<void> {
        for (const workbookId of [...this.mounts.keys()]) await this.unmount(workbookId);
    }

    /// Read the columns of a Parquet attachment with the embedded Hyper, the attachments in the folder of the workbook
    /// (`files` null) or in memory
    async readColumns(database: EmbeddedComputeDatabase, workbookId: string, fileName: string, files: AttachmentFiles | null = null): Promise<string[]> {
        await this.mount(database, workbookId, files);
        const connection = await database.connect({ pooled: true });
        try {
            const path = attachmentPath(workbookId, fileName).replace(/'/g, "''");
            const table = await connection.query(`select * from external('${path}', format => 'parquet') limit 0`);
            return table.schema.fields.map(field => field.name);
        } finally {
            await connection.close();
        }
    }
}
