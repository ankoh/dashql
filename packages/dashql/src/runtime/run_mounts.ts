import type * as arrow from 'apache-arrow';
import type * as core from '../core/index.js';

import type { HandleTable } from './store/handles.js';
import type { CachePins } from './query/cache_pins.js';
import { supportsParquet, type ParquetDatabase } from '../platform/hyperdb/hyperdb_parquet_export.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import type { QueryResultCache } from '../platform/query/query_result_cache.js';
import { mountWorkbookAttachments, readAttachmentColumns, unmountWorkbookAttachments } from '../platform/workbook/attachment_mounts.js';

/// The files of the runs of workbooks in the compute database, the `mounts` of the platform of the runtime.
///
/// A statement of the embedded Hyper reads the result of a script of another connection from a Parquet file
/// (see docs/design/script_references.md). The files are files of the query result cache of the app, mounted at its
/// mount path. Hyper writes the files and reads the byte ranges a scan needs from disk. The runtime pins the files of a
/// run (`pin`) so that eviction and other windows leave them alone, releases the pins once the run settled and removes
/// its transient files then. The attachments of a workbook are mounted from its folder, and unmounted when the workbook
/// is deleted. Without the query result cache a run materializes nothing. The calls wait until the platform set the
/// compute database up.
export function createRunMounts(computeDatabase: () => Promise<EmbeddedComputeDatabase>, cache: QueryResultCache | null, handles: HandleTable, pins: CachePins): core.RuntimeMounts {
    const database = async (): Promise<ParquetDatabase> => {
        const database = await computeDatabase();
        if (!supportsParquet(database)) throw new Error('Scripts that read the results of other scripts or attachments need a compute database that reads Parquet files');
        return database;
    };
    const requireCache = () => {
        if (cache == null) throw new Error('Scripts that read the results of other scripts need the query result cache');
        return cache;
    };
    /// The name of a file below the mount path
    const nameOf = (cache: QueryResultCache, path: string) => {
        if (!path.startsWith(`${cache.mountPath}/`) || path.slice(cache.mountPath.length + 1).includes('/')) throw new Error(`The path ${path} is no file of the run`);
        return path.slice(cache.mountPath.length + 1);
    };
    return {
        prefix: () => cache?.mountPath ?? null,
        fileName: key => {
            const cache = requireCache();
            return key != null ? cache.newFileName(key) : cache.newTransientFileName();
        },
        pin: async path => {
            const cache = requireCache();
            const name = nameOf(cache, path);
            await cache.mount(await database());
            return pins.add(await cache.pin(name));
        },
        write: async (path, handle) => {
            const cache = requireCache();
            const table = handles.get<arrow.Table>(handle);
            if (table == null) throw new Error('The statement has no result');
            await cache.writeTable(await database(), table, nameOf(cache, path));
            return table.numRows;
        },
        attachments: async workbookId => {
            await mountWorkbookAttachments(await database(), workbookId);
        },
        attachmentColumns: async (workbookId, fileName) => readAttachmentColumns(await database(), workbookId, fileName),
        dropAttachments: workbookId => unmountWorkbookAttachments(workbookId),
    };
}
