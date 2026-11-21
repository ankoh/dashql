import type * as arrow from 'apache-arrow';
import type * as core from '../core/index.js';

import type { HandleTable } from './store/handles.js';
import type { CachePins } from './query/cache_pins.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import type { QueryResultCache } from '../platform/query/query_result_cache.js';
import type { AttachmentFiles, AttachmentMounts } from '../platform/workbook/attachment_mounts.js';

/// The files of the runs of workbooks in the compute database, the `mounts` of the platform of the runtime.
///
/// A statement of the embedded Hyper reads the result of a script of another connection from a Parquet file
/// (see docs/design/script_references.md). The files are files of the query result cache of the app, mounted at its
/// mount path. Hyper writes the files and reads the byte ranges a scan needs from disk. The runtime pins the files of a
/// run (`pin`) so that eviction and other windows leave them alone, releases the pins once the run settled and removes
/// its transient files then. The attachments of a workbook are mounted from its folder, and unmounted when the workbook
/// is deleted. Without the query result cache a run materializes nothing. The calls wait until the platform set the
/// compute database up.
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

export function createRunMounts(database: () => Promise<EmbeddedComputeDatabase>, cache: QueryResultCache | null, handles: HandleTable, pins: CachePins, attachments: AttachmentMounts): core.RuntimeMounts {
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
        attachments: async (workbookId, files) => {
            await attachments.mount(await database(), workbookId, memoryFiles(handles, files));
        },
        attachmentColumns: async (workbookId, fileName, files) => attachments.readColumns(await database(), workbookId, fileName, memoryFiles(handles, files)),
        dropAttachments: workbookId => attachments.unmount(workbookId),
    };
}
