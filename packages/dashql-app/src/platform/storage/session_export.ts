import JSZip from 'jszip';

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import type { StorageBackend, SessionData, PageData, ConnectionParams } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import { sanitizeConnectionParamsForSharing } from '../../connection/connection_params.js';

/// The target platform a shared session link points at.
export enum SessionLinkTarget {
    NATIVE,
    WEB
}

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

/// Export a session as a shareable ZIP.
///
/// Pages, scripts, the draft and the session name are read straight from disk (via
/// `exportSessionAsZip`) so the shared archive matches the persisted session exactly. Only the
/// connection params are rewritten for sharing: the stored params are swapped for the live
/// connection's params, sanitized of secrets (or dropped entirely for a dataless share), with the
/// login hint optionally stripped.
export async function exportSessionAsSharedZip(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: any,
    // When true, include the connection identity (secrets stripped) so a recipient gets a
    // prefilled sign-in. When false, drop it entirely and share a dataless session.
    withConnectionInfo: boolean = true,
    // When true, carry the login hint (the sharer's resolved account username) in the shared
    // connection identity. When false, strip it so the link/file doesn't reveal who shared it.
    withLoginHint: boolean = true
): Promise<Blob> {
    const sharedConnectionParams: ConnectionParams = withConnectionInfo
        ? sanitizeConnectionParamsForSharing(connectionParams, withLoginHint)
        : { dataless: {} };

    return await exportSessionAsZip(sessionId, backend, {
        transformSession: (session: SessionData): SessionData => ({
            ...session,
            connectionParams: sharedConnectionParams,
        }),
    });
}

/// Export a session as a shareable link that carries the session ZIP inline.
export async function exportSessionAsUrl(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: any,
    target: SessionLinkTarget,
    withConnectionInfo: boolean = true,
    withLoginHint: boolean = true
): Promise<URL> {
    const zipBlob = await exportSessionAsSharedZip(backend, sessionId, connectionParams, withConnectionInfo, withLoginHint);
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

    // Wrap the zip in AppEventData - convert to base64 string as required by JSON schema
    const eventData: app_event.AppEventData = {
        session: BASE64URL_CODEC.encode(zipBytes.buffer)
    };

    // Encode the JSON to base64
    const eventDataJson = JSON.stringify(eventData);
    const eventDataBytes = new TextEncoder().encode(eventDataJson);
    const eventDataBase64 = BASE64URL_CODEC.encode(eventDataBytes.buffer);

    switch (target) {
        case SessionLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?data=${eventDataBase64}`);
        case SessionLinkTarget.NATIVE:
            return new URL(`dashql://localhost?data=${eventDataBase64}`);
    }
}
