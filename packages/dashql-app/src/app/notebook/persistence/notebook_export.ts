import JSZip from 'jszip';

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import type { StorageBackend, NotebookData, ScriptFolderData, ConnectionParams } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';
import { BASE64URL_CODEC } from '../../../shared/utils/base64.js';
import { sanitizeConnectionParamsForSharing } from '../connections/connection_params.js';

/// The target platform a shared notebook link points at.
export enum NotebookLinkTarget {
    NATIVE,
    WEB
}

/// Options controlling how a notebook is exported to a ZIP.
export interface NotebookExportOptions {
    /// Transform the notebook metadata after it is loaded from the backend and before it is written
    /// into the ZIP. The script folders and draft are always exported verbatim from disk; only the
    /// `dashql-notebook.json` payload passes through here. The sharing path uses this to sanitize
    /// connection secrets, strip the login hint, force a dataless connection, or override the name.
    /// Receives the notebook as stored; returns the notebook to serialize.
    transformNotebook?: (notebook: NotebookData) => NotebookData;
}

/// Creates a ZIP file from notebook data and script folders
export async function createNotebookZip(
    notebookData: NotebookData,
    folders: ScriptFolderData[],
    draftSql: string | null
): Promise<Blob> {
    const zip = new JSZip();

    // Add notebook metadata
    zip.file(STORAGE_NOTEBOOK_FILE, JSON.stringify(notebookData, null, 2));

    // Add script folders and files
    const scriptsFolder = zip.folder(STORAGE_SCRIPTS_FOLDER);
    if (!scriptsFolder) {
        throw new Error('Failed to create scripts folder in ZIP');
    }

    for (const folder of folders) {
        const scriptFolder = scriptsFolder.folder(folder.name);
        if (!scriptFolder) {
            throw new Error(`Failed to create script folder: ${folder.name}`);
        }

        for (const script of folder.scripts) {
            scriptFolder.file(script.name, script.sql);
        }
    }

    // Add draft script if present
    if (draftSql) {
        scriptsFolder.file(STORAGE_SCRIPT_DRAFT, draftSql);
    }

    // Generate ZIP blob with compression
    return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
}

/// Exports a notebook as a ZIP file by loading from storage backend.
///
/// Script folders and the draft are always exported exactly as they exist on disk. Pass
/// `options.transformNotebook` to adjust the notebook metadata on the way out (e.g. sanitize
/// connection secrets or drop the login hint when sharing).
export async function exportNotebookAsZip(
    notebookId: string,
    backend: StorageBackend,
    options: NotebookExportOptions = {}
): Promise<Blob> {
    // Load data from backend
    const notebookData = await backend.loadNotebook(notebookId);
    const folders = await backend.loadScriptFolders(notebookId);
    const draftSql = await backend.loadScriptDraft(notebookId);

    // Apply the caller's notebook transform (sharing sanitization, name override, ...)
    const outNotebook = options.transformNotebook ? options.transformNotebook(notebookData) : notebookData;

    // Create ZIP from loaded data
    return await createNotebookZip(outNotebook, folders, draftSql);
}

/// Export a notebook as a shareable ZIP.
///
/// Script folders, scripts, the draft and the notebook name are read straight from disk (via
/// `exportNotebookAsZip`) so the shared archive matches the persisted notebook exactly. Only the
/// connection params are rewritten for sharing: the stored params are swapped for the live
/// connection's params, sanitized of secrets (or dropped entirely for a dataless share), with the
/// login hint optionally stripped.
export async function exportNotebookAsSharedZip(
    backend: StorageBackend,
    notebookId: string,
    connectionParams: any,
    // When true, include the connection identity (secrets stripped) so a recipient gets a
    // prefilled sign-in. When false, drop it entirely and share a dataless notebook.
    withConnectionInfo: boolean = true,
    // When true, carry the login hint (the sharer's resolved account username) in the shared
    // connection identity. When false, strip it so the link/file doesn't reveal who shared it.
    withLoginHint: boolean = true
): Promise<Blob> {
    const sharedConnectionParams: ConnectionParams = withConnectionInfo
        ? sanitizeConnectionParamsForSharing(connectionParams, withLoginHint)
        : { dataless: {} };

    return await exportNotebookAsZip(notebookId, backend, {
        transformNotebook: (notebook: NotebookData): NotebookData => ({
            ...notebook,
            connectionParams: sharedConnectionParams,
        }),
    });
}

/// Export a notebook as a shareable link that carries the notebook ZIP inline.
export async function exportNotebookAsUrl(
    backend: StorageBackend,
    notebookId: string,
    connectionParams: any,
    target: NotebookLinkTarget,
    withConnectionInfo: boolean = true,
    withLoginHint: boolean = true
): Promise<URL> {
    const zipBlob = await exportNotebookAsSharedZip(backend, notebookId, connectionParams, withConnectionInfo, withLoginHint);
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

    // Wrap the zip in AppEventData - convert to base64 string as required by JSON schema
    const eventData: app_event.AppEventData = {
        notebook: BASE64URL_CODEC.encode(zipBytes.buffer)
    };

    // Encode the JSON to base64
    const eventDataJson = JSON.stringify(eventData);
    const eventDataBytes = new TextEncoder().encode(eventDataJson);
    const eventDataBase64 = BASE64URL_CODEC.encode(eventDataBytes.buffer);

    switch (target) {
        case NotebookLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?data=${eventDataBase64}`);
        case NotebookLinkTarget.NATIVE:
            return new URL(`dashql://localhost?data=${eventDataBase64}`);
    }
}
