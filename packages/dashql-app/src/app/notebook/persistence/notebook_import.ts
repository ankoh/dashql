import JSZip from 'jszip';
import type { StorageBackend, NotebookData } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

/// Imports a notebook from a ZIP file.
export async function importNotebookFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    allocateNotebookId: () => string
): Promise<string> {
    const zip = await JSZip.loadAsync(zipBlob);

    // Read and parse notebook metadata
    const manifestFile = zip.file(STORAGE_NOTEBOOK_FILE);
    if (!manifestFile) {
        throw new Error(`Invalid ZIP: missing ${STORAGE_NOTEBOOK_FILE}`);
    }

    const notebookData: NotebookData = JSON.parse(await manifestFile.async('text'));

    // Always allocate a fresh notebook UUID for imported notebooks to avoid conflicts. The UUID is
    // the authoritative identity; the imported notebook is implicitly OPFS-backed.
    const newNotebookId = allocateNotebookId();

    notebookData.notebookId = newNotebookId;
    delete notebookData.notebookPath;
    try {
        await backend.saveNotebookManifest(newNotebookId, notebookData);

        // Import script folders and files
        const scriptsFolder = zip.folder(STORAGE_SCRIPTS_FOLDER);
        if (scriptsFolder) {
            await importScriptsFromZip(scriptsFolder, backend, newNotebookId);
        }
    } catch (error) {
        // The UUID is freshly allocated, so removing it cannot affect an existing notebook. Cleanup
        // is best-effort: preserve the original import error if rollback itself fails.
        try {
            await backend.deleteNotebook(newNotebookId);
        } catch {
            // Ignore rollback errors.
        }
        throw error;
    }

    return newNotebookId;
}

/**
 * Import all script folders from the ZIP's scripts folder
 */
async function importScriptsFromZip(
    scriptsFolder: JSZip,
    backend: StorageBackend,
    notebookId: string
): Promise<void> {
    const pageEntries: Array<{ name: string; folderPath: string }> = [];

    // Collect script folders
    scriptsFolder.forEach((relativePath, file) => {
        if (file.dir && relativePath !== '') {
            // Remove trailing slash for folder name
            const folderName = relativePath.replace(/\/$/, '');
            pageEntries.push({ name: folderName, folderPath: relativePath });
        }
    });

    // Sort folders lexicographically with numeric components handled naturally.
    pageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    // Import each folder
    for (const pageEntry of pageEntries) {
        await backend.createScriptFolder(notebookId, pageEntry.name);
        await importScriptsInFolder(scriptsFolder, backend, notebookId, pageEntry.name, pageEntry.folderPath);
    }

    // Import composer script if present
    await importComposerScript(scriptsFolder, backend, notebookId);
}

/**
 * Import all scripts in a single folder
 */
async function importScriptsInFolder(
    scriptsFolder: JSZip,
    backend: StorageBackend,
    notebookId: string,
    folderName: string,
    folderPath: string
): Promise<void> {
    const scriptFiles: Array<{ name: string; path: string }> = [];

    // Collect SQL files directly under this script folder.
    scriptsFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.startsWith(folderPath) && relativePath.endsWith('.sql')) {
            const fileName = relativePath.split('/').pop();
            if (fileName && fileName !== STORAGE_SCRIPT_DRAFT) {
                scriptFiles.push({ name: fileName, path: relativePath });
            }
        }
    });

    // Sort scripts lexicographically (natural sort for 01-, 02-, etc.)
    scriptFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    // Load content and save each script
    for (const scriptMeta of scriptFiles) {
        const scriptFile = scriptsFolder.file(scriptMeta.path);

        if (scriptFile) {
            const content = await scriptFile.async('text');
            await backend.saveScript(
                notebookId,
                folderName,
                scriptMeta.name,
                content
            );
        }
    }
}

/**
 * Import composer script if present
 */
async function importComposerScript(
    scriptsFolder: JSZip,
    backend: StorageBackend,
    notebookId: string
): Promise<void> {
    const composerFile = scriptsFolder.file(STORAGE_SCRIPT_DRAFT);
    if (composerFile) {
        const composerSql = await composerFile.async('text');
        await backend.saveScriptDraft(notebookId, composerSql);
    }
}
