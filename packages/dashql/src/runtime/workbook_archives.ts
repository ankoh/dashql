import * as arrow from 'apache-arrow';
import type * as core from '../core/index.js';

import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import { exportArrowTableAsParquet } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { readParquetFile } from '../platform/hyperdb/hyperdb_parquet_read.js';
import type { HandleTable } from './store/handles.js';
import {
    archiveError,
    BlobReader,
    BlobWriter,
    storedEntryBlob,
    TextWriter,
    Uint8ArrayReader,
    ZipReader,
    ZipWriter,
    type Entry,
    type FileEntry,
} from '../platform/workbook/workbook_zip.js';

// The `.dashql` archives of the imports and exports of the runtime (`archives` of the platform,
// docs/design/dashql_runtime.md, docs/design/workbook_tables.md). The runtime decides what an archive holds and reads,
// the platform keeps the ZIP container (zip.js) and the Parquet files of the workbook tables (the embedded Hyper). The
// rows of a workbook table cross as Arrow IPC, the attachments and results by handle.

/// An archive that is read, with the reader of its central directory
interface ArchiveReader {
    blob: Blob;
    zip: ZipReader<unknown>;
    entries: Promise<Entry[]>;
}

/// `archives` of the platform over the handle table and the embedded database that writes and scans the Parquet files.
/// The database is set up when an archive first needs it.
export function createRuntimeArchives(handles: HandleTable, database: (context: string) => Promise<EmbeddedComputeDatabase>): core.RuntimeArchives {
    const readers = new Map<number, ArchiveReader>();
    const blobOf = (handle: number): Blob => {
        const blob = handles.get<unknown>(handle);
        if (!(blob instanceof Blob)) throw new Error(`The handle ${handle} holds no archive`);
        return blob;
    };
    const reader = (archive: number): ArchiveReader => {
        let read = readers.get(archive);
        if (read == null) {
            const blob = blobOf(archive);
            // The names are checked by the core, with the errors of the workbook format
            const zip = new ZipReader(new BlobReader(blob), { filenameValidation: 'tolerant' });
            read = { blob, zip, entries: zip.getEntries() };
            readers.set(archive, read);
        }
        return read;
    };
    const fileEntry = async (archive: number, index: number): Promise<FileEntry> => {
        const entry = (await reader(archive).entries)[index];
        if (entry == null || entry.directory) throw new Error(`Invalid ZIP: no file at entry ${index}`);
        return entry as FileEntry;
    };
    const checked = async <T>(operation: () => Promise<T>): Promise<T> => {
        try {
            return await operation();
        } catch (error) {
            throw archiveError(error);
        }
    };
    return {
        write: entries => checked(async () => {
            // The archive is streamed into a Blob that the browser keeps. The entries are added one after the other,
            // concurrent entries would wait in memory.
            const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 6 });
            try {
                for (const entry of entries) {
                    const level = entry.stored ? 0 : undefined;
                    if (entry.table != null) {
                        // Hyper compresses the pages with Snappy, but the footer of a Parquet file is not compressed,
                        // and it is most of a small table: the tables are deflated
                        const bytes = await exportArrowTableAsParquet(await database('workbook_export'), arrow.tableFromIPC(entry.table));
                        await zip.add(entry.fileName, new Uint8ArrayReader(bytes), { level });
                    } else if (entry.file != null) {
                        const file = handles.get<Blob | Uint8Array>(entry.file);
                        if (file == null) throw new Error(`Missing file of ${entry.fileName}`);
                        await zip.add(entry.fileName, file instanceof Blob ? new BlobReader(file) : new Uint8ArrayReader(file), { level });
                    }
                }
                return await zip.close();
            } catch (error) {
                await zip.close().catch(() => { });
                throw error;
            }
        }),
        bytes: async archive => new Uint8Array(await blobOf(archive).arrayBuffer()),
        // The core doesn't normalize Unicode, the names are passed in NFC
        entries: archive => checked(async () => (await reader(archive).entries).map(entry => ({ filename: entry.filename, directory: entry.directory }))),
        readText: (archive, index) => checked(async () => await (await fileEntry(archive, index)).getData(new TextWriter())),
        readTable: (archive, index) => checked(async () => {
            const file = await (await fileEntry(archive, index)).getData(new BlobWriter(), { checkCrc32: true });
            return arrow.tableToIPC(await readParquetFile(await database('workbook_import'), file), 'stream');
        }),
        readFile: (archive, index, slice) => checked(async () => {
            const entry = await fileEntry(archive, index);
            // A stored entry stays a slice of the archive until it is read, it is checked against the CRC-32 of the
            // entry when the import streams it. Any other entry is inflated into memory and checked by zip.js.
            const stored = slice ? await storedEntryBlob(reader(archive).blob, entry) : null;
            return stored != null
                ? { file: stored, crc32: entry.crc32 ?? null }
                : { file: await entry.getData(new BlobWriter(), { checkCrc32: true }), crc32: null };
        }),
        close: async archive => {
            const read = readers.get(archive);
            readers.delete(archive);
            await read?.zip.close().catch(() => { });
        },
    };
}
