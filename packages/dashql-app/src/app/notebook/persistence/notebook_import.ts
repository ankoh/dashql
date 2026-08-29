import JSZip from 'jszip';

import type { NotebookData, ScriptData, StorageBackend } from './storage_backend.js';
import {
    STORAGE_NOTEBOOK_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_DRAFT,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';
import type { NotebookBundle, NotebookBundleWriteOptions } from './notebook_bundle.js';
import { writeNotebookBundle } from './notebook_bundle.js';
import { describeNotebookValidationError, validateNotebookData } from './notebook_validation.js';

export interface NotebookZipImportOptions extends NotebookBundleWriteOptions { }

type NotebookZipImportOptionsInput = NotebookZipImportOptions | (() => string);

type ZipObjectWithOriginalName = JSZip.JSZipObject & { unsafeOriginalName?: string };

interface ParsedZipEntry {
    path: string;
    file: JSZip.JSZipObject;
}

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/// Parse and validate a portable notebook ZIP without modifying storage.
export async function readNotebookBundleFromZip(zipBlob: Blob): Promise<NotebookBundle> {
    const zip = await JSZip.loadAsync(zipBlob);
    const destinations = new Map<string, ParsedZipEntry>();
    const scriptFolderNames = new Map<string, string>();

    for (const file of Object.values(zip.files)) {
        const originalPath = (file as ZipObjectWithOriginalName).unsafeOriginalName ?? file.name;
        const path = normalizeBundlePath(originalPath);
        if (file.dir) {
            const parts = path.split('/');
            if (parts.length === 2 && destinationKey(parts[0]) === destinationKey(STORAGE_SCRIPTS_FOLDER)) {
                addScriptFolderName(scriptFolderNames, parts[1]);
            }
            continue;
        }
        if (!isBundleFile(path)) {
            continue;
        }
        const key = destinationKey(path);
        if (destinations.has(key)) {
            throw new Error(`Invalid ZIP: duplicate destination ${path}`);
        }
        destinations.set(key, { path, file });
    }

    const manifest = destinations.get(destinationKey(STORAGE_NOTEBOOK_FILE));
    if (!manifest) {
        throw new Error(`Invalid ZIP: missing ${STORAGE_NOTEBOOK_FILE}`);
    }

    let parsedNotebook: unknown;
    try {
        parsedNotebook = JSON.parse(await manifest.file.async('text'));
    } catch {
        throw new Error(`Invalid ZIP: invalid ${STORAGE_NOTEBOOK_FILE}`);
    }
    if (parsedNotebook == null || typeof parsedNotebook !== 'object' || Array.isArray(parsedNotebook)) {
        throw new Error(`Invalid ZIP: invalid ${STORAGE_NOTEBOOK_FILE}`);
    }
    const notebook = parsedNotebook as NotebookData;
    const validation = validateNotebookData(notebook);
    if (!validation.ok) {
        throw new Error(
            `Invalid ZIP: invalid ${STORAGE_NOTEBOOK_FILE}: ${describeNotebookValidationError(validation.error)}`,
        );
    }

    const schema = destinations.get(destinationKey(STORAGE_SCRIPT_SCHEMA));
    const functions = destinations.get(destinationKey(STORAGE_SCRIPT_FUNCTIONS));
    const draftPath = `${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`;
    const draft = destinations.get(destinationKey(draftPath));
    const folders = new Map<string, { name: string; scripts: Array<{ name: string; file: JSZip.JSZipObject }> }>();
    for (const [key, name] of scriptFolderNames) {
        folders.set(key, { name, scripts: [] });
    }

    for (const entry of destinations.values()) {
        const entryKey = destinationKey(entry.path);
        if (!entryKey.startsWith(`${destinationKey(STORAGE_SCRIPTS_FOLDER)}/`)
            || entryKey === destinationKey(draftPath)) {
            continue;
        }
        const parts = entry.path.split('/');
        if (!entryKey.endsWith('.sql')) {
            continue;
        }
        if (parts.length !== 3) {
            throw new Error(`Invalid ZIP: SQL scripts must be directly inside a script folder: ${entry.path}`);
        }
        const [, folderName, scriptName] = parts;
        if (destinationKey(scriptName) === destinationKey(STORAGE_SCRIPT_DRAFT)) {
            throw new Error(`Invalid ZIP: reserved script name outside scripts root: ${entry.path}`);
        }
        const folderKey = destinationKey(folderName);
        let folder = folders.get(folderKey);
        if (!folder) {
            folder = { name: folderName, scripts: [] };
            folders.set(folderKey, folder);
        } else if (folder.name !== folderName) {
            throw new Error(`Invalid ZIP: duplicate normalized script folder ${folderName}`);
        }
        folder.scripts.push({ name: scriptName, file: entry.file });
    }

    const parsedFolders = await Promise.all([...folders.values()]
        .sort((a, b) => NATURAL_SORT.compare(a.name, b.name))
        .map(async folder => {
            const scripts: ScriptData[] = await Promise.all(folder.scripts
                .sort((a, b) => NATURAL_SORT.compare(a.name, b.name))
                .map(async script => ({ name: script.name, sql: await script.file.async('text') })));
            return { name: folder.name, scripts };
        }));

    const [schemaSql, functionsSql, draftSql] = await Promise.all([
        schema ? schema.file.async('text') : null,
        functions ? functions.file.async('text') : null,
        draft ? draft.file.async('text') : null,
    ]);

    return { notebook, schemaSql, functionsSql, folders: parsedFolders, draftSql };
}

/// Import a portable notebook ZIP. By default the source UUID is preserved.
export async function importNotebookFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    optionsInput: NotebookZipImportOptionsInput = {},
): Promise<string> {
    const bundle = await readNotebookBundleFromZip(zipBlob);
    const options = typeof optionsInput === 'function'
        ? { targetNotebookId: optionsInput(), targetIsFresh: true }
        : optionsInput;
    return await writeNotebookBundle(bundle, backend, options);
}

function normalizeBundlePath(input: string): string {
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

function isBundleFile(path: string): boolean {
    const key = destinationKey(path);
    return key === destinationKey(STORAGE_NOTEBOOK_FILE)
        || key === destinationKey(STORAGE_SCRIPT_SCHEMA)
        || key === destinationKey(STORAGE_SCRIPT_FUNCTIONS)
        || (key.startsWith(`${destinationKey(STORAGE_SCRIPTS_FOLDER)}/`) && key.endsWith('.sql'));
}

function addScriptFolderName(folders: Map<string, string>, name: string): void {
    const key = destinationKey(name);
    const existing = folders.get(key);
    if (existing != null && existing !== name) {
        throw new Error(`Invalid ZIP: duplicate normalized script folder ${name}`);
    }
    folders.set(key, name);
}
