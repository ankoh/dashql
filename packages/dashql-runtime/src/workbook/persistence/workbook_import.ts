import type { DashQLWorkbookFormat, WorkbookArchivePlan } from '@ankoh/dashql-core';

import type { DataFileData, StorageBackend, WorkbookData } from '../../storage/storage_backend.js';
import type { WorkbookBundle, WorkbookBundleResult, WorkbookBundleWriteOptions } from '../../storage/workbook_bundle.js';
import { regenerateBundleConnectionIds, seedConnectionCatalogs, writeWorkbookBundle } from '../../storage/workbook_bundle.js';
import { emptyWorkbookTables, workbookTablesToBundle, type WorkbookTableName } from '../../storage/workbook_tables.js';
import { readWorkbookTableParquet, type ParquetReadDatabase } from '../../storage/workbook_tables_parquet.js';
import { loadWorkbookFormat } from '../../storage/workbook_format.js';
import {
    BlobReader,
    BlobWriter,
    archiveError,
    storedEntryBlob,
    TextWriter,
    Uint8ArrayWriter,
    ZipReader,
    type Entry,
    type FileEntry,
} from './workbook_zip.js';

// The import of a `.dashql` archive is planned by the workbook format of the core (`workbook_format::import`): the
// host lists the entries of the archive with zip.js, the core decides what each entry is, the host reads it and the
// core builds the bundle. Workbook tables are scanned by the embedded Hyper, see docs/design/workbook_tables.md.

export interface WorkbookZipImportOptions extends WorkbookBundleWriteOptions {
    /// Generate fresh connection identities for a clone/create-new import
    regenerateConnectionIds?: boolean;
}

/// Parse and validate a portable workbook ZIP without modifying storage. Only the central directory and the small
/// files are read, the query results stay slices of the archive until the import streams them into the cache.
///
/// An archive holds the workbook tables as `<table>.parquet` (docs/design/workbook_tables.md), which the embedded Hyper
/// reads. Archives of older versions hold the files of a workbook folder and are read without it.
export async function readWorkbookBundleFromZip(zipBlob: Blob, database: ParquetReadDatabase | null): Promise<WorkbookBundle> {
    // The names are checked by the core, with the errors of the workbook format
    const zip = new ZipReader(new BlobReader(zipBlob), { filenameValidation: 'tolerant' });
    try {
        const entries = await zip.getEntries();
        const format = await loadWorkbookFormat();
        // The core doesn't normalize Unicode, the names are passed in NFC
        const plan = format.planArchive(entries.map(entry => ({ filename: entry.filename.normalize('NFC'), directory: entry.directory })));
        if (plan.kind === 'folder') {
            return await readFolderEntries(format, zipBlob, entries, plan);
        }
        if (database == null) {
            throw new Error('Invalid ZIP: reading the workbook tables needs the embedded database');
        }
        return await readTableEntries(zipBlob, entries, plan, database);
    } catch (error) {
        throw archiveError(error);
    } finally {
        await zip.close();
    }
}

/// Read the workbook tables of an archive. The data of the result tables stays slices of the archive, the other
/// files are read with their CRC-32 checked.
async function readTableEntries(
    zipBlob: Blob,
    entries: Entry[],
    plan: Extract<WorkbookArchivePlan, { kind: 'tables' }>,
    database: ParquetReadDatabase,
): Promise<WorkbookBundle> {
    const tables = emptyWorkbookTables();
    for (const entry of plan.entries) {
        const file = entries[entry.index] as FileEntry;
        if ('table' in entry) {
            const name = entry.table as WorkbookTableName;
            const bytes = await file.getData(new BlobWriter(), { checkCrc32: true });
            (tables as unknown as Record<WorkbookTableName, object[]>)[name] = await readWorkbookTableParquet(database, name, bytes);
        } else {
            const stored = entry.storedSlice ? await storedEntryBlob(zipBlob, file) : null;
            tables.data.set(entry.data, stored != null
                ? { bytes: stored, crc32: file.crc32 }
                : { bytes: await file.getData(new BlobWriter(), { checkCrc32: true }) });
        }
    }
    return await workbookTablesToBundle(tables, 'Invalid ZIP');
}

/// Read an archive of a workbook folder of an older version: the top-level files are migrated in memory by the core,
/// the scripts and attachments are read as they are
async function readFolderEntries(
    format: DashQLWorkbookFormat,
    zipBlob: Blob,
    entries: Entry[],
    plan: Extract<WorkbookArchivePlan, { kind: 'folder' }>,
): Promise<WorkbookBundle> {
    const texts: [string, string][] = [];
    const scripts: { name: string; sql: string }[] = [];
    const data: { name: string; bytes: string }[] = [];
    const results: { key: string; bytes: string; crc32?: number }[] = [];
    const attachments = new Map<string, Uint8Array>();
    const resultFiles = new Map<string, Blob>();
    for (const entry of plan.entries) {
        const file = entries[entry.index] as FileEntry;
        switch (entry.kind) {
            case 'text':
                texts.push([entry.path, await file.getData(new TextWriter())]);
                break;
            case 'script':
                scripts.push({ name: entry.name, sql: await file.getData(new TextWriter()) });
                break;
            case 'attachment': {
                const token = `data:${data.length}`;
                attachments.set(token, await file.getData(new Uint8ArrayWriter()));
                data.push({ name: entry.name, bytes: token });
                break;
            }
            case 'result': {
                // An export stores the results without compression, they stay slices of the archive and are checked
                // against the CRC-32 of the entry when the import streams them. A result that was compressed, e.g. by
                // another tool that repacked the archive, is inflated into memory and checked by zip.js.
                const token = `result:${results.length}`;
                const stored = await storedEntryBlob(zipBlob, file);
                if (stored != null) {
                    resultFiles.set(token, stored);
                    results.push({ key: entry.key, bytes: token, crc32: file.crc32 });
                } else {
                    resultFiles.set(token, await file.getData(new BlobWriter(), { checkCrc32: true }));
                    results.push({ key: entry.key, bytes: token });
                }
                break;
            }
        }
    }
    const bundle = format.readFolderArchive(plan, { texts, scripts, data, results });
    const out: WorkbookBundle = {
        workbook: bundle.workbook as WorkbookData,
        catalogs: bundle.catalogs,
        scripts: bundle.scripts,
        data: bundle.data.flatMap((file): DataFileData[] => {
            const bytes = attachments.get(file.bytes);
            return bytes == null ? [] : [{ name: file.name, bytes }];
        }),
    };
    const read: WorkbookBundleResult[] = (bundle.results ?? []).flatMap(result => {
        const bytes = resultFiles.get(result.bytes);
        return bytes == null ? [] : [{ key: result.key, bytes, ...(result.crc32 == null ? {} : { crc32: result.crc32 }) }];
    });
    return read.length > 0 ? { ...out, results: read } : out;
}

/// Import a portable workbook ZIP. By default the source UUID is preserved.
export async function importWorkbookFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    database: ParquetReadDatabase | null,
    { regenerateConnectionIds, ...options }: WorkbookZipImportOptions = {},
): Promise<string> {
    let bundle = await readWorkbookBundleFromZip(zipBlob, database);
    if (regenerateConnectionIds) bundle = regenerateBundleConnectionIds(bundle);
    const workbookId = await writeWorkbookBundle(bundle, backend, options);
    await seedConnectionCatalogs(backend, bundle, workbookId);
    return workbookId;
}
