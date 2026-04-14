import JSZip from 'jszip';
import type { StorageBackend, SessionData, PageData } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

/// Creates a ZIP file from session data and pages
export async function createSessionZip(
    sessionData: SessionData,
    pages: PageData[],
    draftSql: string | null
): Promise<Blob> {
    const zip = new JSZip();

    // Add session metadata
    zip.file(STORAGE_SESSION_FILE, JSON.stringify(sessionData, null, 2));

    // Add pages and scripts
    const notebookFolder = zip.folder(STORAGE_NOTEBOOK_FOLDER);
    if (!notebookFolder) {
        throw new Error('Failed to create notebook folder in ZIP');
    }

    for (const page of pages) {
        const pageFolder = notebookFolder.folder(page.name);
        if (!pageFolder) {
            throw new Error(`Failed to create page folder: ${page.name}`);
        }

        for (const script of page.scripts) {
            pageFolder.file(script.name, script.sql);
        }
    }

    // Add draft script if present
    if (draftSql) {
        notebookFolder.file(STORAGE_SCRIPT_DRAFT, draftSql);
    }

    // Generate ZIP blob with compression
    return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
}

/// Exports a session as a ZIP file by loading from storage backend
export async function exportSessionAsZip(
    sessionPath: string,
    backend: StorageBackend
): Promise<Blob> {
    // Load data from backend
    const sessionData = await backend.loadSession(sessionPath);
    const pages = await backend.loadNotebookPages(sessionPath);
    const draftSql = await backend.loadNotebookScriptDraft(sessionPath);

    // Create ZIP from loaded data
    return await createSessionZip(sessionData, pages, draftSql);
}
