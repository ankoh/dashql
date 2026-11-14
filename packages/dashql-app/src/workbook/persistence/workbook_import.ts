import type { ScriptData, StorageBackend } from '@ankoh/dashql-sdk/storage/storage_backend';
import {
    STORAGE_ATTACHMENTS_FOLDER,
    validateDataFileName,
    STORAGE_SCRIPTS_FOLDER,
} from '@ankoh/dashql-sdk/storage/storage_backend';
import type { WorkbookBundle, WorkbookBundleResult, WorkbookBundleWriteOptions } from '@ankoh/dashql-sdk/storage/workbook_bundle';
import {
    assembleWorkbookBundle,
    isBundleCatalogPath,
    readWorkbookBundleHead,
    regenerateBundleConnectionIds,
    seedConnectionCatalogs,
    writeWorkbookBundle,
} from '@ankoh/dashql-sdk/storage/workbook_bundle';
import { MemoryFolder } from '@ankoh/dashql-sdk/storage/migration/migration_folder';
import {
    emptyWorkbookTables,
    isDataTableName,
    isWorkbookTableName,
    RESULT_TABLE_PREFIX,
    WORKBOOK_TABLE,
    workbookTablesToBundle,
    TABLE_FILE_EXTENSION,
    type WorkbookTableName,
    type WorkbookTables,
} from '@ankoh/dashql-sdk/storage/workbook_tables';
import { readWorkbookTableParquet, workbookTableFileName, type ParquetReadDatabase } from '../../storage/workbook_tables_parquet.js';
import { WORKBOOK_RESULTS_FOLDER, workbookResultKey } from './workbook_query_results.js';
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

export interface WorkbookZipImportOptions extends WorkbookBundleWriteOptions {
    /// Generate fresh connection identities for a clone/create-new import
    regenerateConnectionIds?: boolean;
}

type WorkbookZipImportOptionsInput = WorkbookZipImportOptions | (() => string);

interface ParsedZipEntry {
    path: string;
    file: FileEntry;
}

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/// Parse and validate a portable workbook ZIP without modifying storage. Only the central directory and the small
/// files are read, the query results stay slices of the archive until the import streams them into the cache.
///
/// An archive holds the workbook tables as `<table>.parquet` (docs/design/workbook_tables.md), which the embedded Hyper
/// reads.
/// Archives of older versions hold the files of a workbook folder and are read without it.
export async function readWorkbookBundleFromZip(zipBlob: Blob, database: ParquetReadDatabase | null): Promise<WorkbookBundle> {
    // The names are checked below, with the errors of the workbook format
    const zip = new ZipReader(new BlobReader(zipBlob), { filenameValidation: 'tolerant' });
    try {
        const entries = await zip.getEntries();
        // The paths are checked by the readers, the workbook table is a file at the top level
        if (!entries.some(entry => !entry.directory && destinationKey(entry.filename) === WORKBOOK_TABLE_FILE)) {
            return await readWorkbookBundleEntries(zipBlob, entries);
        }
        if (database == null) {
            throw new Error('Invalid ZIP: reading the workbook tables needs the embedded database');
        }
        return await workbookTablesToBundle(await readWorkbookTableEntries(zipBlob, entries, database), 'Invalid ZIP');
    } catch (error) {
        throw archiveError(error);
    } finally {
        await zip.close();
    }
}

/// The file name of the workbook table in an archive, it marks an archive of workbook tables
const WORKBOOK_TABLE_FILE = workbookTableFileName(WORKBOOK_TABLE);

/// Read the workbook tables of an archive. The data of the result tables stays slices of the archive, the other
/// files are read with their CRC-32 checked.
async function readWorkbookTableEntries(zipBlob: Blob, entries: Entry[], database: ParquetReadDatabase): Promise<WorkbookTables> {
    const tables = emptyWorkbookTables();
    const seen = new Set<string>();
    for (const file of entries) {
        const path = normalizeBundlePath(file.filename);
        if (file.directory || path.includes('/') || !destinationKey(path).endsWith(TABLE_FILE_EXTENSION)) continue;
        const tableName = path.slice(0, -TABLE_FILE_EXTENSION.length);
        if (seen.has(destinationKey(tableName))) {
            throw new Error(`Invalid ZIP: duplicate table ${path}`);
        }
        seen.add(destinationKey(tableName));
        if (isWorkbookTableName(tableName)) {
            const bytes = await file.getData(new BlobWriter(), { checkCrc32: true });
            (tables as unknown as Record<WorkbookTableName, object[]>)[tableName] = await readWorkbookTableParquet(database, tableName, bytes);
        } else if (isDataTableName(tableName)) {
            const stored = tableName.startsWith(RESULT_TABLE_PREFIX) ? await storedEntryBlob(zipBlob, file) : null;
            tables.data.set(tableName, stored != null
                ? { bytes: stored, crc32: file.crc32 }
                : { bytes: await file.getData(new BlobWriter(), { checkCrc32: true }) });
        }
    }
    return tables;
}

async function readWorkbookBundleEntries(zipBlob: Blob, entries: Entry[]): Promise<WorkbookBundle> {
    const destinations = new Map<string, ParsedZipEntry>();
    const text = (file: FileEntry) => file.getData(new TextWriter());

    for (const file of entries) {
        validateDataPath(file.filename);
        const path = normalizeBundlePath(file.filename);
        validateDataPath(path);
        if (file.directory) continue;
        if (!isBundleFile(path)) {
            continue;
        }
        const key = destinationKey(path);
        if (destinations.has(key)) {
            throw new Error(`Invalid ZIP: duplicate destination ${path}`);
        }
        destinations.set(key, { path, file });
    }

    // The top-level files are migrated in memory, the scripts and attachments are read as they are
    const head = await readWorkbookBundleHead(new MemoryFolder(await Promise.all([...destinations]
        .filter(([key, entry]) => isTopLevelFile(key) || isBundleCatalogPath(entry.path))
        .map(async ([key, entry]) => [isBundleCatalogPath(entry.path) ? entry.path : key, await text(entry.file)] as [string, string]))), 'Invalid ZIP');

    const scripts: Array<{ name: string; file: FileEntry }> = [];

    for (const entry of destinations.values()) {
        const entryKey = destinationKey(entry.path);
        if (!entryKey.startsWith(`${destinationKey(STORAGE_SCRIPTS_FOLDER)}/`)) {
            continue;
        }
        const parts = entry.path.split('/');
        if (!entryKey.endsWith('.sql')) {
            continue;
        }
        if (parts.length !== 2) {
            throw new Error(`Invalid ZIP: SQL scripts must be directly inside scripts/: ${entry.path}`);
        }
        const [, scriptName] = parts;
        if (destinationKey(scriptName) === destinationKey('dashql-draft.sql')) {
            throw new Error(`Invalid ZIP: draft scripts are not supported: ${entry.path}`);
        }
        scripts.push({ name: scriptName, file: entry.file });
    }

    const parsedScripts: ScriptData[] = await Promise.all(scripts
        .sort((a, b) => NATURAL_SORT.compare(a.name, b.name))
        .map(async script => ({ name: script.name, sql: await text(script.file) })));

    const data = await Promise.all([...destinations.values()]
        .filter(entry => destinationKey(entry.path).startsWith(`${STORAGE_ATTACHMENTS_FOLDER}/`))
        .sort((a, b) => NATURAL_SORT.compare(a.path, b.path))
        .map(async entry => ({ name: entry.path.split('/')[1], bytes: await entry.file.getData(new Uint8ArrayWriter()) })));
    // The cached query results, named after their keys. Other files of the folder are ignored. An export stores them
    // without compression, they stay slices of the archive. A result that was compressed, e.g. by another tool that
    // repacked the archive, is inflated into memory.
    const results: WorkbookBundleResult[] = [];
    for (const entry of destinations.values()) {
        const parts = entry.path.split('/');
        const key = parts.length === 2 && parts[0] === WORKBOOK_RESULTS_FOLDER ? workbookResultKey(parts[1]) : null;
        if (key == null) continue;
        // A slice is checked against the CRC-32 of the entry when the import streams it, zip.js checks what it inflates
        const stored = await storedEntryBlob(zipBlob, entry.file);
        if (stored != null) results.push({ key, bytes: stored, crc32: entry.file.crc32 });
        else results.push({ key, bytes: await entry.file.getData(new BlobWriter(), { checkCrc32: true }) });
    }
    const bundle = assembleWorkbookBundle(head, parsedScripts, data);
    return results.length > 0 ? { ...bundle, results } : bundle;
}

function validateDataPath(path: string): void {
    if (!path.replace(/\\/g, '/').toLowerCase().startsWith(`${STORAGE_ATTACHMENTS_FOLDER}/`)) return;
    if (path.toLowerCase() === `${STORAGE_ATTACHMENTS_FOLDER}/`) return;
    const parts = path.split('/');
    if (parts.length !== 2 || parts[0].toLowerCase() !== STORAGE_ATTACHMENTS_FOLDER) {
        throw new Error(`Invalid ZIP: attachments must be directly inside attachments/: ${path}`);
    }
    validateDataFileName(parts[1]);
}

/// Import a portable workbook ZIP. By default the source UUID is preserved.
export async function importWorkbookFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    database: ParquetReadDatabase | null,
    optionsInput: WorkbookZipImportOptionsInput = {},
): Promise<string> {
    let bundle = await readWorkbookBundleFromZip(zipBlob, database);
    const { regenerateConnectionIds, ...options }: WorkbookZipImportOptions = typeof optionsInput === 'function'
        ? { targetWorkbookId: optionsInput(), targetIsFresh: true, regenerateConnectionIds: true }
        : optionsInput;
    if (regenerateConnectionIds) bundle = regenerateBundleConnectionIds(bundle);
    const workbookId = await writeWorkbookBundle(bundle, backend, options);
    await seedConnectionCatalogs(backend, bundle, workbookId);
    return workbookId;
}

function normalizeBundlePath(input: string): string {
    if (input.includes('\0')) throw new Error(`Invalid ZIP: NUL in path ${input}`);
    const path = input.replace(/\\/g, '/');
    if (path.startsWith('/')) {
        throw new Error(`Invalid ZIP: absolute path ${input}`);
    }
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') {
            continue;
        }
        if (part === '..') {
            throw new Error(`Invalid ZIP: path traversal ${input}`);
        }
        parts.push(part.normalize('NFC'));
    }
    return parts.join('/');
}

function destinationKey(path: string): string {
    return path.normalize('NFC').toLowerCase();
}

/// Is the path a top-level file of the workbook folder? Older versions name the files differently,
/// the workbook migration needs any of them.
function isTopLevelFile(key: string): boolean {
    return !key.includes('/') && key.startsWith('dashql-');
}

function isBundleFile(path: string): boolean {
    const key = destinationKey(path);
    return isTopLevelFile(key)
        || isBundleCatalogPath(path)
        || key.startsWith(`${STORAGE_ATTACHMENTS_FOLDER}/`)
        || key.startsWith(`${WORKBOOK_RESULTS_FOLDER}/`)
        || (key.startsWith(`${destinationKey(STORAGE_SCRIPTS_FOLDER)}/`) && key.endsWith('.sql'));
}
