import type * as arrow from 'apache-arrow';
import type * as core from '../../../core/index.js';

import type { HandleTable } from '../../store/handles.js';
import { supportsParquet, type ParquetDatabase } from '../../../platform/platform/hyperdb/hyperdb_parquet_export.js';
import type { EmbeddedComputeDatabase } from '../../../platform/platform/database/embedded_database.js';
import type { QueryResultCache } from '../../../platform/query/query_result_cache.js';
import { mountWorkbookAttachments, readAttachmentColumns, unmountWorkbookAttachments } from '../../../platform/workbook/attachments/attachment_mounts.js';

/// The files of a run: the pins of the files it reads and writes, its transient files
interface RunFiles {
    pins: Array<() => Promise<void>>;
    transient: string[];
    /// Was the run released? A pin that arrives later is released at once.
    released: boolean;
}

/// The files of the runs of a runtime, `dispose` releases what the runs still keep
export interface RunMounts extends core.RuntimeMounts {
    /// Release the files of every run, e.g. when the runtime goes before its runs released them
    dispose(): Promise<void>;
}

/// The files of the runs of workbooks in the compute database, the `mounts` of the platform of the runtime.
///
/// A statement of the embedded Hyper reads the result of a script of another connection from a Parquet file
/// (see docs/design/script_references.md). The files are files of the query result cache of the app, mounted at its
/// mount path. The result of a script whose key is reusable is a new file of its key, every other result is a transient
/// file. Hyper writes the files and reads the byte ranges a scan needs from disk. A run pins its files until it releases
/// them, so eviction and other windows leave them alone; its transient files are removed then. The attachments of a
/// workbook are mounted from its folder, and unmounted when the workbook is deleted. Without the query result cache a
/// run materializes nothing. The calls wait until the platform set the compute database up.
export function createRunMounts(computeDatabase: () => Promise<EmbeddedComputeDatabase>, cache: QueryResultCache | null, handles: HandleTable): RunMounts {
    const runs = new Map<number, RunFiles>();
    const database = async (): Promise<ParquetDatabase> => {
        const database = await computeDatabase();
        if (!supportsParquet(database)) throw new Error('Scripts that read the results of other scripts or attachments need a compute database that reads Parquet files');
        return database;
    };
    const filesOf = (run: number) => {
        let files = runs.get(run);
        if (files == null) {
            files = { pins: [], transient: [], released: false };
            runs.set(run, files);
        }
        return files;
    };
    const requireCache = () => {
        if (cache == null) throw new Error('Scripts that read the results of other scripts need the query result cache');
        return cache;
    };
    /// The name of a file of the run below the mount path
    const nameOf = (cache: QueryResultCache, path: string) => {
        if (!path.startsWith(`${cache.mountPath}/`) || path.slice(cache.mountPath.length + 1).includes('/')) throw new Error(`The path ${path} is no file of the run`);
        return path.slice(cache.mountPath.length + 1);
    };
    /// Mount the files and pin a file until the release of the run. The files of the run are taken when the runtime
    /// calls, a write that ends after the release of its run releases its pin at once.
    const keep = async (run: number, name: string) => {
        const files = filesOf(run);
        const cache = requireCache();
        await cache.mount(await database());
        const unpin = await cache.pin(name);
        if (files.released) {
            await unpin();
            throw new Error(`The run ${run} was released`);
        }
        files.pins.push(unpin);
    };
    /// Release the files of a run, its transient files are removed
    const release = async (run: number) => {
        const files = runs.get(run);
        runs.delete(run);
        if (files == null) return;
        files.released = true;
        const pins = files.pins.splice(0);
        await Promise.all(pins.map(unpin => unpin().catch(() => { })));
        // Every listing removes them too, e.g. those of a window that was closed during its run
        await Promise.all(files.transient.map(name => cache?.remove(name).catch(() => {})));
    };
    return {
        prefix: () => cache?.mountPath ?? null,
        fileName: (run, key) => {
            const cache = requireCache();
            if (key != null) return cache.newFileName(key);
            const name = cache.newTransientFileName();
            filesOf(run).transient.push(name);
            return name;
        },
        write: async (run, path, handle) => {
            const cache = requireCache();
            const table = handles.get<arrow.Table>(handle);
            if (table == null) throw new Error('The statement has no result');
            const name = nameOf(cache, path);
            await keep(run, name);
            await cache.writeTable(await database(), table, name);
            return table.numRows;
        },
        use: async (run, path) => {
            await keep(run, nameOf(requireCache(), path));
        },
        release,
        attachments: async workbookId => {
            await mountWorkbookAttachments(await database(), workbookId);
        },
        attachmentColumns: async (workbookId, fileName) => readAttachmentColumns(await database(), workbookId, fileName),
        dropAttachments: workbookId => unmountWorkbookAttachments(workbookId),
        dispose: async () => {
            await Promise.all([...runs.keys()].map(release));
        },
    };
}
