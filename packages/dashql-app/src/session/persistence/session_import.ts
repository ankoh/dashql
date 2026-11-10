import type { ScriptData, StorageBackend } from '../../storage/storage_backend.js';
import {
    STORAGE_ATTACHMENTS_FOLDER,
    validateDataFileName,
    STORAGE_SCRIPTS_FOLDER,
} from '../../storage/storage_backend.js';
import type { SessionBundle, SessionBundleResult, SessionBundleWriteOptions } from '../../storage/session_bundle.js';
import {
    assembleSessionBundle,
    isBundleCatalogPath,
    readSessionBundleHead,
    regenerateBundleConnectionIds,
    seedConnectionCatalogs,
    writeSessionBundle,
} from '../../storage/session_bundle.js';
import { MemoryFolder } from '../../storage/migration/migration_folder.js';
import { SESSION_RESULTS_FOLDER, sessionResultKey } from './session_query_results.js';
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
} from './session_zip.js';

export interface SessionZipImportOptions extends SessionBundleWriteOptions {
    /// Generate fresh connection identities for a clone/create-new import
    regenerateConnectionIds?: boolean;
}

type SessionZipImportOptionsInput = SessionZipImportOptions | (() => string);

interface ParsedZipEntry {
    path: string;
    file: FileEntry;
}

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/// Parse and validate a portable session ZIP without modifying storage. Only the central directory and the small
/// files are read, the query results stay slices of the archive until the import streams them into the cache.
export async function readSessionBundleFromZip(zipBlob: Blob): Promise<SessionBundle> {
    // The names are checked below, with the errors of the session format
    const zip = new ZipReader(new BlobReader(zipBlob), { filenameValidation: 'tolerant' });
    try {
        return await readSessionBundleEntries(zipBlob, await zip.getEntries());
    } catch (error) {
        throw archiveError(error);
    } finally {
        await zip.close();
    }
}

async function readSessionBundleEntries(zipBlob: Blob, entries: Entry[]): Promise<SessionBundle> {
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
    const head = await readSessionBundleHead(new MemoryFolder(await Promise.all([...destinations]
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
    const results: SessionBundleResult[] = [];
    for (const entry of destinations.values()) {
        const parts = entry.path.split('/');
        const key = parts.length === 2 && parts[0] === SESSION_RESULTS_FOLDER ? sessionResultKey(parts[1]) : null;
        if (key == null) continue;
        // A slice is checked against the CRC-32 of the entry when the import streams it, zip.js checks what it inflates
        const stored = await storedEntryBlob(zipBlob, entry.file);
        if (stored != null) results.push({ key, bytes: stored, crc32: entry.file.crc32 });
        else results.push({ key, bytes: await entry.file.getData(new BlobWriter(), { checkCrc32: true }) });
    }
    const bundle = assembleSessionBundle(head, parsedScripts, data);
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

/// Import a portable session ZIP. By default the source UUID is preserved.
export async function importSessionFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    optionsInput: SessionZipImportOptionsInput = {},
): Promise<string> {
    let bundle = await readSessionBundleFromZip(zipBlob);
    const { regenerateConnectionIds, ...options }: SessionZipImportOptions = typeof optionsInput === 'function'
        ? { targetSessionId: optionsInput(), targetIsFresh: true, regenerateConnectionIds: true }
        : optionsInput;
    if (regenerateConnectionIds) bundle = regenerateBundleConnectionIds(bundle);
    const sessionId = await writeSessionBundle(bundle, backend, options);
    await seedConnectionCatalogs(backend, bundle, sessionId);
    return sessionId;
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

/// Is the path a top-level file of the session folder? Older versions name the files differently,
/// the session migration needs any of them.
function isTopLevelFile(key: string): boolean {
    return !key.includes('/') && key.startsWith('dashql-');
}

function isBundleFile(path: string): boolean {
    const key = destinationKey(path);
    return isTopLevelFile(key)
        || isBundleCatalogPath(path)
        || key.startsWith(`${STORAGE_ATTACHMENTS_FOLDER}/`)
        || key.startsWith(`${SESSION_RESULTS_FOLDER}/`)
        || (key.startsWith(`${destinationKey(STORAGE_SCRIPTS_FOLDER)}/`) && key.endsWith('.sql'));
}
