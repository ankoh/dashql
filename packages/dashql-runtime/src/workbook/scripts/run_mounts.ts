import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { HandleTable } from '../../store/handles.js';
import type { ParquetDatabase } from '@ankoh/dashql-platform/platform/hyperdb/hyperdb_parquet_export';
import type { QueryResultCache } from '@ankoh/dashql-platform/query/query_result_cache';
import { mountWorkbookAttachments, readAttachmentColumns } from '@ankoh/dashql-platform/workbook/attachments/attachment_mounts';

/// The files of a run: the pins of the files it reads and writes, its transient files
interface RunFiles {
    pins: Array<() => Promise<void>>;
    transient: string[];
}

/// The files of the runs of workbooks in the compute database, the `mounts` of the platform of the runtime.
///
/// A statement of the embedded Hyper reads the result of a script of another connection from a Parquet file
/// (see docs/design/script_references.md). The files are files of the query result cache of the app, mounted at its
/// mount path. The result of a script whose key is reusable is a new file of its key, every other result is a transient
/// file. Hyper writes the files and reads the byte ranges a scan needs from disk. A run pins its files until it releases
/// them, so eviction and other windows leave them alone; its transient files are removed then. The attachments of a
/// workbook are mounted from its folder. Without the query result cache a run materializes nothing.
export function createRunMounts(database: ParquetDatabase, cache: QueryResultCache | null, handles: HandleTable): core.RuntimeMounts {
    const runs = new Map<number, RunFiles>();
    const filesOf = (run: number) => {
        let files = runs.get(run);
        if (files == null) {
            files = { pins: [], transient: [] };
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
    /// Mount the files and pin a file until the release of the run
    const keep = async (run: number, name: string) => {
        const cache = requireCache();
        await cache.mount(database);
        const unpin = await cache.pin(name);
        filesOf(run).pins.push(unpin);
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
            await cache.writeTable(database, table, name);
            return table.numRows;
        },
        use: async (run, path) => {
            await keep(run, nameOf(requireCache(), path));
        },
        release: async run => {
            const files = runs.get(run);
            runs.delete(run);
            if (files == null) return;
            await Promise.all(files.pins.map(release => release()));
            // Every listing removes them too, e.g. those of a window that was closed during its run
            await Promise.all(files.transient.map(name => cache?.remove(name).catch(() => {})));
        },
        attachments: async workbookId => {
            await mountWorkbookAttachments(database, workbookId);
        },
        attachmentColumns: (workbookId, fileName) => readAttachmentColumns(database, workbookId, fileName),
    };
}
