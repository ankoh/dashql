import type * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase } from '../embedded_database.js';
import { copyArrowTableAsParquet } from '../hyperdb/hyperdb_parquet_export.js';
import { getOPFSRoot } from '../opfs_root.js';
import { STORAGE_WORKBOOKS_FOLDER } from '../storage/storage_backend.js';
import { crc32CheckStream } from '../utils/crc32.js';

/// The folder of the results in a workbook folder, `workbooks/<id>/results/`
export const RESULTS_FOLDER = 'results';
/// The mount paths of the results of the workbooks in the compute database, `RESULTS_MOUNT_ROOT` of the core
export const RESULTS_MOUNT_PREFIX = '/mnt/external/results';
/// The suffix of a file that is being written, also the one of a transient file of the core
const TRANSIENT_SUFFIX = '.transient.parquet';
/// The Web Lock of a file, readers hold it shared, a move or removal takes it exclusively if nobody holds it
const LOCK_PREFIX = 'dashql-workbook-results/';

/// The mount path of the results of a workbook
export function resultsMountPath(workbookId: string): string {
    return `${RESULTS_MOUNT_PREFIX}/${workbookId}`;
}

/// A file of the results of a workbook
export interface ResultFileStat {
    /// The file name
    name: string;
    /// The size in bytes
    size: number;
    /// The time of the write in milliseconds since the epoch
    mtimeMs: number;
}

/// The stored results of the scripts of the workbooks (docs/design/workbook_results.md): the Parquet files of
/// `workbooks/<id>/results/` in the origin private file system, or in the root of Node.
///
/// The platform only lists, reads, writes, moves and removes files. The core names them and decides which file is the
/// result of a script and which files are garbage (`runtime/results.rs` of the bindings). The compute database mounts
/// the results of a workbook read-write at `resultsMountPath`, Hyper writes a file there and reads it in place. A file
/// is written under a transient name and moved to its name once it is complete, so readers never see a partial file.
/// Readers pin the files they read with a shared Web Lock across the windows of the app, a move or removal leaves a
/// pinned file alone. After this window moved or removed files of a workbook, the next use of its mount refreshes it,
/// so the database forgets the files that are gone; queries that run keep reading the files they opened. A refresh that
/// the database refuses, e.g. while its queries run, is tried again with the next use.
export interface WorkbookResultFiles {
    /// Mount the results of a workbook in a database, refresh the mount after files were moved or removed
    mount(database: EmbeddedComputeDatabase, workbookId: string): Promise<void>;
    /// Remove the mount of the results of a workbook, e.g. one that was deleted. The mounts outlive a runtime, they
    /// belong to the database.
    unmount(workbookId: string): Promise<void>;
    /// The Parquet files of the results of a workbook, empty without a folder
    files(workbookId: string): Promise<ResultFileStat[]>;
    /// Keep a file while it is read or written, resolves with the release once the file is pinned. The release
    /// resolves once the file can be moved or removed.
    pin(workbookId: string, name: string): Promise<() => Promise<void>>;
    /// Write a table as a file that is pinned, resolves with its rows
    writeTable(database: EmbeddedComputeDatabase, workbookId: string, table: arrow.Table, name: string): Promise<number>;
    /// Read a file into a table while it is pinned, null if the file is gone
    readTable(database: EmbeddedComputeDatabase, workbookId: string, name: string): Promise<arrow.Table | null>;
    /// The bytes of a file, the caller pins it while it reads them
    readFile(workbookId: string, name: string): Promise<Blob>;
    /// Stream bytes into a new file, a slice of a dropped archive never sits in memory. Fails and leaves no file if the
    /// bytes don't have the CRC-32.
    importFile(workbookId: string, name: string, data: Blob, options?: { crc32?: number }): Promise<void>;
    /// Rename a file that nobody reads, resolves false if it is read and stays
    move(workbookId: string, from: string, to: string): Promise<boolean>;
    /// Remove a file that nobody reads, resolves false if it is read and stays. A file that is gone is removed.
    remove(workbookId: string, name: string): Promise<boolean>;
}

/// The options of the results of the workbooks
export interface WorkbookResultFilesOptions {
    /// The root of the files of the app, the origin private file system by default
    getRoot?: () => Promise<FileSystemDirectoryHandle>;
    /// The locks of the windows of the app
    locks?: LockManager;
}

/// The mount of the results of a workbook in a database
interface ResultMount {
    database: EmbeddedComputeDatabase;
    /// Did this window move or remove files since the mount was refreshed? The database still knows the files it opened.
    stale: boolean;
}

/// A file handle that can move itself, not every browser has `move`
type MovableFileHandle = FileSystemFileHandle & { move?(name: string): Promise<void> };

/// The results of the workbooks in `workbooks/<id>/results/` of a root
export function createWorkbookResultFiles(options: WorkbookResultFilesOptions = {}): WorkbookResultFiles {
    const getRoot = options.getRoot ?? getOPFSRoot;
    const locks = options.locks ?? navigator.locks;
    const lockName = (workbookId: string, name: string) => `${LOCK_PREFIX}${workbookId}/${name}`;

    /// The results folder of a workbook, null without one unless it is created
    const directory = async (workbookId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
        try {
            const workbooks = await (await getRoot()).getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create });
            const workbook = await workbooks.getDirectoryHandle(workbookId, { create });
            return await workbook.getDirectoryHandle(RESULTS_FOLDER, { create });
        } catch (error) {
            if (!create && (error as DOMException)?.name === 'NotFoundError') return null;
            throw error;
        }
    };
    const requireDirectory = async (workbookId: string) => (await directory(workbookId, true))!;

    const mounts = new Map<string, ResultMount>();
    let chain: Promise<unknown> = Promise.resolve();
    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = chain.then(operation);
        chain = result.catch(() => {});
        return result;
    };
    const markStale = (workbookId: string) => {
        const mount = mounts.get(workbookId);
        if (mount != null) mount.stale = true;
    };
    const mount = (database: EmbeddedComputeDatabase, workbookId: string) => serialize(async () => {
        const path = resultsMountPath(workbookId);
        let current = mounts.get(workbookId);
        if (current != null && current.database !== database) {
            await current.database.removeExternalDirectory(path).catch(() => {});
            mounts.delete(workbookId);
            current = undefined;
        }
        if (current == null) {
            await database.registerExternalDirectory(await requireDirectory(workbookId), path, 'readwrite');
            mounts.set(workbookId, { database, stale: false });
        } else if (current.stale) {
            // The refresh only lets the database forget the files that are gone, a result never reuses a name. The
            // database refuses it while its queries run, the mount stays stale then and the next use refreshes it.
            // Changes during the refresh mark the mount stale again.
            current.stale = false;
            try {
                await database.refreshExternalDirectory(path);
            } catch {
                current.stale = true;
            }
        }
    });
    const unmount = (workbookId: string) => serialize(async () => {
        const current = mounts.get(workbookId);
        if (current == null) return;
        mounts.delete(workbookId);
        await current.database.removeExternalDirectory(resultsMountPath(workbookId)).catch(() => {});
    });

    const pin = (workbookId: string, name: string): Promise<() => Promise<void>> => new Promise(acquired => {
        // The request settles once the lock is released, not when the callback returns
        const held = locks.request(lockName(workbookId, name), { mode: 'shared' }, () => new Promise<void>(release => {
            acquired(async () => {
                release();
                await held.catch(() => {});
            });
        }));
    });
    /// Change a file that nobody reads, resolves false if it is read
    const exclusively = async (workbookId: string, name: string, change: () => Promise<void>): Promise<boolean> =>
        await locks.request(lockName(workbookId, name), { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (lock == null) return false;
            await change();
            markStale(workbookId);
            return true;
        });
    const remove = async (workbookId: string, name: string): Promise<boolean> => {
        const dir = await directory(workbookId, false);
        if (dir == null) return true;
        return await exclusively(workbookId, name, async () => {
            await dir.removeEntry(name).catch((error: unknown) => {
                if ((error as DOMException)?.name !== 'NotFoundError') throw error;
            });
        });
    };
    /// Move a file of a folder to another name, with a copy where the browser can't move files
    const moveFile = async (dir: FileSystemDirectoryHandle, from: string, to: string) => {
        const handle = await dir.getFileHandle(from) as MovableFileHandle;
        if (typeof handle.move === 'function') {
            await handle.move(to);
        } else {
            await (await handle.getFile()).stream().pipeTo(await (await dir.getFileHandle(to, { create: true })).createWritable());
            await dir.removeEntry(from);
        }
    };
    /// Write a file under a transient name and move it in place once it is complete. A failed write leaves nothing.
    const writeFile = async (workbookId: string, name: string, write: (temporary: string) => Promise<void>) => {
        const dir = await requireDirectory(workbookId);
        const temporary = `${crypto.randomUUID()}${TRANSIENT_SUFFIX}`;
        const releaseTemporary = await pin(workbookId, temporary);
        let written = false;
        try {
            await write(temporary);
            await moveFile(dir, temporary, name);
            written = true;
        } finally {
            await releaseTemporary();
            if (!written) await remove(workbookId, temporary).catch(() => false);
        }
    };

    return {
        mount,
        unmount,
        files: async workbookId => {
            const dir = await directory(workbookId, false);
            if (dir == null) return [];
            const files: ResultFileStat[] = [];
            for await (const [name, handle] of dir.entries()) {
                if (handle.kind !== 'file' || !name.endsWith('.parquet')) continue;
                try {
                    const file = await (handle as FileSystemFileHandle).getFile();
                    files.push({ name, size: file.size, mtimeMs: file.lastModified });
                } catch {
                    // A file that another window removed meanwhile
                }
            }
            return files;
        },
        pin,
        writeTable: async (database, workbookId, table, name) => {
            await mount(database, workbookId);
            await writeFile(workbookId, name, temporary => copyArrowTableAsParquet(database, table, `${resultsMountPath(workbookId)}/${temporary}`));
            return table.numRows;
        },
        readTable: async (database, workbookId, name) => {
            const release = await pin(workbookId, name);
            try {
                // The file may have been removed between the listing and the pin
                const dir = await directory(workbookId, false);
                if (dir == null) return null;
                try {
                    await dir.getFileHandle(name);
                } catch {
                    return null;
                }
                await mount(database, workbookId);
                const connection = await database.connect({ pooled: true });
                try {
                    const path = `${resultsMountPath(workbookId)}/${name}`.replace(/'/g, "''");
                    return await connection.query(`SELECT * FROM external('${path}', format => 'parquet')`);
                } finally {
                    await connection.close();
                }
            } finally {
                await release();
            }
        },
        readFile: async (workbookId, name) => await (await (await requireDirectory(workbookId)).getFileHandle(name)).getFile(),
        importFile: async (workbookId, name, data, importOptions = {}) => {
            const dir = await requireDirectory(workbookId);
            // The pipe closes the file once the stream ends, and aborts it if the stream fails, e.g. on a checksum that
            // differs
            await writeFile(workbookId, name, async temporary => {
                const source = importOptions.crc32 == null ? data.stream()
                    : data.stream().pipeThrough(crc32CheckStream(importOptions.crc32, () => `the imported result ${name}`));
                await source.pipeTo(await (await dir.getFileHandle(temporary, { create: true })).createWritable());
            });
        },
        move: async (workbookId, from, to) => {
            const dir = await directory(workbookId, false);
            if (dir == null) return true;
            return await exclusively(workbookId, from, () => moveFile(dir, from, to));
        },
        remove,
    };
}
