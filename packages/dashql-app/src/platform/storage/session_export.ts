import JSZip from 'jszip';
import type { StorageBackend, SessionData, PageData } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

/// Options controlling how a session is exported to a ZIP.
export interface SessionExportOptions {
    /// Transform the session metadata after it is loaded from the backend and before it is written
    /// into the ZIP. The notebook pages and draft are always exported verbatim from disk; only the
    /// `dashql-session.json` payload passes through here. The sharing path uses this to sanitize
    /// connection secrets, strip the login hint, force a dataless connection, or override the name.
    /// Receives the session as stored; returns the session to serialize.
    transformSession?: (session: SessionData) => SessionData;
}

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

/// Exports a session as a ZIP file by loading from storage backend.
///
/// Pages and the draft are always exported exactly as they exist on disk. Pass
/// `options.transformSession` to adjust the session metadata on the way out (e.g. sanitize
/// connection secrets or drop the login hint when sharing).
export async function exportSessionAsZip(
    sessionPath: string,
    backend: StorageBackend,
    options: SessionExportOptions = {}
): Promise<Blob> {
    // Load data from backend
    const sessionData = await backend.loadSession(sessionPath);
    const pages = await backend.loadNotebookPages(sessionPath);
    const draftSql = await backend.loadNotebookScriptDraft(sessionPath);

    // Apply the caller's session transform (sharing sanitization, name override, ...)
    const outSession = options.transformSession ? options.transformSession(sessionData) : sessionData;

    // Create ZIP from loaded data
    return await createSessionZip(outSession, pages, draftSql);
}
