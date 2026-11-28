import type * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase } from '../embedded_database.js';
import { copyArrowTableAsParquet } from '../hyperdb/hyperdb_parquet_export.js';
import { getOPFSRoot } from '../opfs_root.js';
import { STORAGE_WORKBOOKS_FOLDER } from '../storage/storage_backend.js';
import { appendRowNumbers } from '../utils/arrow_vectors.js';
import { crc32CheckStream } from '../utils/crc32.js';

/// The folder of the results in a workbook folder, `workbooks/<id>/results/`
export const RESULTS_FOLDER = 'results';
/// The mount paths of the results of the workbooks in the compute database, `RESULTS_MOUNT_ROOT` of the core
export const RESULTS_MOUNT_PREFIX = '/mnt/external/results';
/// The suffix of a file that is being written, also the one of a transient file of the core
const TRANSIENT_SUFFIX = '.transient.parquet';
/// The Web Lock of a file, readers hold it shared, a move or removal takes it exclusively if nobody holds it
const LOCK_PREFIX = 'dashql-workbook-results/';
/// The last column of a file of a result: the rows numbered from 1 in the order of the result, 64-bit integers. Hyper
/// scans a table or a file of millions of rows in parallel and returns its rows in no particular order, so the order of
/// a query with `ORDER BY` would be lost once its result is a file. `writeTable` numbers the rows while the table still
/// has them in order, `readTable` orders by the column and leaves it out. The scan references of the planner leave it
/// out too, `RESULT_ROW_COLUMN` of `planner/script_references.rs` holds the same name. The column stays in the bytes of
/// the file: an exported archive, a published workbook and the file of an agent carry it. Files of earlier versions
/// don't have it (docs/design/workbook_results.md, Storing Results).
export const RESULT_ROW_COLUMN = '__dashql_row';

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
    /// belong to the database. A write or mount that began before fails instead of mounting the results again or
    /// creating their folder, later ones mount them again, e.g. for a workbook that was replaced.
    unmount(workbookId: string): Promise<void>;
    /// The Parquet files of the results of a workbook, empty without a folder
    files(workbookId: string): Promise<ResultFileStat[]>;
    /// Keep a file while it is read or written, resolves with the release once the file is pinned. The release
    /// resolves once the file can be moved or removed.
    pin(workbookId: string, name: string): Promise<() => Promise<void>>;
    /// Write a table as a file that is pinned, with the order of its rows in `RESULT_ROW_COLUMN`, resolves with its rows
    writeTable(database: EmbeddedComputeDatabase, workbookId: string, table: arrow.Table, name: string): Promise<number>;
    /// Read a file into a table while it is pinned, its rows in order and without `RESULT_ROW_COLUMN`, null if the file
    /// is gone
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

/// A file handle that can move itself, not every browser has `move`. `move(directory, name)`: WebKit doesn't take the
/// name alone.
type MovableFileHandle = FileSystemFileHandle & { move?(directory: FileSystemDirectoryHandle, name: string): Promise<void> };

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
    /// The unmounts of each workbook. A write or mount that began before an unmount refuses to mount the results or to
    /// create their folder: the workbook was deleted or replaced meanwhile, and its folder may be gone.
    const unmounts = new Map<string, number>();
    const unmountsOf = (workbookId: string) => unmounts.get(workbookId) ?? 0;
    const checkMounted = (workbookId: string, since: number) => {
        if (unmountsOf(workbookId) !== since) throw new Error(`The results of the workbook ${workbookId} were unmounted`);
    };
    /// The results folder of a workbook, created unless the workbook was unmounted since
    const requireDirectory = async (workbookId: string, since: number = unmountsOf(workbookId)) => {
        checkMounted(workbookId, since);
        return (await directory(workbookId, true))!;
    };

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
    const mount = (database: EmbeddedComputeDatabase, workbookId: string, since: number = unmountsOf(workbookId)) => serialize(async () => {
        checkMounted(workbookId, since);
        const path = resultsMountPath(workbookId);
        let current = mounts.get(workbookId);
        if (current != null && current.database !== database) {
            await current.database.removeExternalDirectory(path).catch(() => {});
            mounts.delete(workbookId);
            current = undefined;
        }
        if (current == null) {
            await database.registerExternalDirectory(await requireDirectory(workbookId, since), path, 'readwrite');
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
    const unmount = (workbookId: string) => {
        // The writes and mounts that began before refuse from now on, also those that wait for the operations before
        unmounts.set(workbookId, unmountsOf(workbookId) + 1);
        return removeMount(workbookId);
    };
    const removeMount = (workbookId: string) => serialize(async () => {
        const current = mounts.get(workbookId);
        if (current == null) return;
        mounts.delete(workbookId);
        await current.database.removeExternalDirectory(resultsMountPath(workbookId)).catch(() => {});
    });

    const pin = (workbookId: string, name: string): Promise<() => Promise<void>> => new Promise((acquired, failed) => {
        // The request settles once the lock is released, not when the callback returns
        const held = locks.request(lockName(workbookId, name), { mode: 'shared' }, () => new Promise<void>(release => {
            acquired(async () => {
                release();
                await held.catch(() => {});
            });
        }));
        // A request that fails before the lock is granted, e.g. with a SecurityError in a sandboxed origin, fails the pin.
        // Once the pin is acquired, this changes nothing.
        held.catch(failed);
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
            await handle.move(dir, to);
        } else {
            await (await handle.getFile()).stream().pipeTo(await (await dir.getFileHandle(to, { create: true })).createWritable());
            await dir.removeEntry(from);
        }
    };
    /// Write a file under a transient name and move it in place once it is complete. A failed write leaves nothing. A
    /// workbook that was unmounted since the write began gets no folder.
    const writeFile = async (workbookId: string, name: string, since: number, write: (temporary: string) => Promise<void>) => {
        const dir = await requireDirectory(workbookId, since);
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
            const since = unmountsOf(workbookId);
            await mount(database, workbookId, since);
            // The rows of the table are in the order of the result: the stream of a query keeps the order of its
            // `ORDER BY`, the scan of the temporary table that the copy writes from doesn't. The name is reserved: a
            // result with a column of the name keeps it as the order of its rows, a second one would collide.
            const numbered = table.schema.fields.some(field => field.name === RESULT_ROW_COLUMN) ? table : appendRowNumbers(table, RESULT_ROW_COLUMN);
            await writeFile(workbookId, name, since, temporary => copyArrowTableAsParquet(database, numbered, `${resultsMountPath(workbookId)}/${temporary}`));
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
                    const source = `external('${path}', format => 'parquet')`;
                    // The schema without rows, Hyper reads only the footer of the file
                    const schema = (await connection.query(`SELECT * FROM ${source} LIMIT 0`)).schema;
                    // A file of an earlier version has no order, its rows come in the order Hyper scans them
                    if (schema.fields.every(field => field.name !== RESULT_ROW_COLUMN)) {
                        return await connection.query(`SELECT * FROM ${source}`);
                    }
                    // The result of a query streams in the order of its top-level ORDER BY. The column is left out
                    // once the rows are read, the selected table shares the vectors of the read.
                    const table = await connection.query(`SELECT * FROM ${source} ORDER BY "${RESULT_ROW_COLUMN}"`);
                    return table.select(schema.fields.map(field => field.name).filter(field => field !== RESULT_ROW_COLUMN));
                } finally {
                    await connection.close();
                }
            } finally {
                await release();
            }
        },
        readFile: async (workbookId, name) => {
            // A read creates no folder, a file of a workbook without one is not found
            const dir = await directory(workbookId, false);
            if (dir == null) throw new DOMException(`The results of the workbook ${workbookId} have no file ${name}`, 'NotFoundError');
            return await (await dir.getFileHandle(name)).getFile();
        },
        importFile: async (workbookId, name, data, importOptions = {}) => {
            const since = unmountsOf(workbookId);
            const dir = await requireDirectory(workbookId, since);
            // The pipe closes the file once the stream ends, and aborts it if the stream fails, e.g. on a checksum that
            // differs
            await writeFile(workbookId, name, since, async temporary => {
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
