import { getOPFSRoot } from '../../platform/opfs_root.js';
import type { ParquetDatabase } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SESSIONS_FOLDER } from '../../storage/storage_backend.js';
import { attachmentPath, attachmentPrefix } from './session_attachments.js';

/// The mounts of the attachments of the sessions in the embedded Hyper.
///
/// The embedded Hyper reads the attachments of a session from the OPFS folder `sessions/<id>/attachments` (a native
/// session mirrors its attachments there), mounted read-only at `/mnt/external/attachments/<id>`. A session is
/// mounted before a plan scans its attachments. A change of the attachments marks the mount stale, the next use
/// refreshes it, so the database looks up the files it opened again.
interface AttachmentMount {
    /// The database that mounted the folder
    database: ParquetDatabase;
    /// Did the attachments change since the mount or its last refresh?
    stale: boolean;
}

const MOUNTS = new Map<string, AttachmentMount>();
/// Mounts and refreshes run one after the other
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(f: () => Promise<T>): Promise<T> {
    const next = pending.then(f, f);
    pending = next.catch(() => {});
    return next;
}

/// Mount the attachments of a session in a database, refresh the mount if they changed. Returns the mount path.
export function mountSessionAttachments(
    database: ParquetDatabase,
    sessionId: string,
    getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot,
): Promise<string> {
    return serialize(async () => {
        const path = attachmentPrefix(sessionId);
        let mount = MOUNTS.get(sessionId);
        if (mount != null && mount.database !== database) {
            await mount.database.removeExternalDirectory(path).catch(() => {});
            MOUNTS.delete(sessionId);
            mount = undefined;
        }
        if (mount == null) {
            const sessions = await (await getRoot()).getDirectoryHandle(STORAGE_SESSIONS_FOLDER, { create: true });
            const session = await sessions.getDirectoryHandle(sessionId, { create: true });
            const folder = await session.getDirectoryHandle(STORAGE_ATTACHMENTS_FOLDER, { create: true });
            await database.registerExternalDirectory(folder, path, 'read');
            MOUNTS.set(sessionId, { database, stale: false });
        } else if (mount.stale) {
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

/// The attachments of a session changed, the next use of the mount refreshes it
export function markSessionAttachmentsChanged(sessionId: string): void {
    const mount = MOUNTS.get(sessionId);
    if (mount != null) mount.stale = true;
}

/// Remove the mount of the attachments of a session
export function unmountSessionAttachments(sessionId: string): Promise<void> {
    return serialize(async () => {
        const mount = MOUNTS.get(sessionId);
        if (mount == null) return;
        MOUNTS.delete(sessionId);
        await mount.database.removeExternalDirectory(attachmentPrefix(sessionId)).catch(() => {});
    });
}

/// Read the columns of a Parquet attachment with the embedded Hyper
export async function readAttachmentColumns(database: ParquetDatabase, sessionId: string, fileName: string): Promise<string[]> {
    await mountSessionAttachments(database, sessionId);
    const connection = await database.connect({ pooled: true });
    try {
        const path = attachmentPath(sessionId, fileName).replace(/'/g, "''");
        const table = await connection.query(`select * from external('${path}', format => 'parquet') limit 0`);
        return table.schema.fields.map(field => field.name);
    } finally {
        await connection.close();
    }
}
