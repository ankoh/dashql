import JSZip from 'jszip';
import type { StorageBackend, SessionData } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

/// Imports a session from a ZIP file.
export async function importSessionFromZip(
    zipBlob: Blob,
    backend: StorageBackend,
    allocateSessionId: () => string
): Promise<string> {
    const zip = await JSZip.loadAsync(zipBlob);

    // Read and parse session metadata
    const manifestFile = zip.file(STORAGE_SESSION_FILE);
    if (!manifestFile) {
        throw new Error(`Invalid ZIP: missing ${STORAGE_SESSION_FILE}`);
    }

    const sessionData: SessionData = JSON.parse(await manifestFile.async('text'));

    // Always allocate a fresh session UUID for imported sessions to avoid conflicts. The UUID is
    // the authoritative identity; the imported session is implicitly OPFS-backed.
    const newSessionId = allocateSessionId();

    sessionData.sessionId = newSessionId;
    delete sessionData.sessionPath;
    await backend.saveSessionManifest(newSessionId, sessionData);

    // Import pages and scripts
    const notebookFolder = zip.folder(STORAGE_NOTEBOOK_FOLDER);
    if (notebookFolder) {
        await importNotebookFromZip(notebookFolder, backend, newSessionId);
    }

    return newSessionId;
}

/**
 * Import all pages from the ZIP's notebook folder
 */
async function importNotebookFromZip(
    notebookFolder: JSZip,
    backend: StorageBackend,
    sessionPath: string
): Promise<void> {
    const pageEntries: Array<{ name: string; folderPath: string }> = [];

    // Collect page folders (both old numeric and new string formats)
    notebookFolder.forEach((relativePath, file) => {
        if (file.dir && relativePath !== '') {
            // Remove trailing slash for folder name
            const folderName = relativePath.replace(/\/$/, '');
            pageEntries.push({ name: folderName, folderPath: relativePath });
        }
    });

    // Sort pages lexicographically (natural sort for page-1, page-2, etc.)
    pageEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    // Import each page
    for (const pageEntry of pageEntries) {
        await backend.createNotebookPage(sessionPath, pageEntry.name);
        await importScriptsInPage(notebookFolder, backend, sessionPath, pageEntry.name, pageEntry.folderPath);
    }

    // Import composer script if present
    await importComposerScript(notebookFolder, backend, sessionPath);
}

/**
 * Import all scripts in a single page
 */
async function importScriptsInPage(
    notebookFolder: JSZip,
    backend: StorageBackend,
    sessionPath: string,
    pageName: string,
    pagePath: string
): Promise<void> {
    const scriptFiles: Array<{ name: string; path: string }> = [];

    // Collect script files in this page (both old numeric and new prefixed formats)
    notebookFolder.forEach((relativePath, file) => {
        if (!file.dir && relativePath.startsWith(pagePath) && relativePath.endsWith('.sql')) {
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
        const scriptFile = notebookFolder.file(scriptMeta.path);

        if (scriptFile) {
            const content = await scriptFile.async('text');
            await backend.saveNotebookScript(
                sessionPath,
                pageName,
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
    notebookFolder: JSZip,
    backend: StorageBackend,
    sessionPath: string
): Promise<void> {
    const composerFile = notebookFolder.file(STORAGE_SCRIPT_DRAFT);
    if (composerFile) {
        const composerSql = await composerFile.async('text');
        await backend.saveNotebookScriptDraft(sessionPath, composerSql);
    }
}
