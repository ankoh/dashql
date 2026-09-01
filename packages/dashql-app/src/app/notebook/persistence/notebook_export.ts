import JSZip from 'jszip';

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import type { StorageBackend, NotebookData, ScriptData, ConnectionParams } from './storage_backend.js';
import {
    STORAGE_NOTEBOOK_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';
import { BASE64URL_CODEC } from '../../../utils/base64.js';
import { sanitizeConnectionParamsForSharing } from '../connections/connection_params.js';
import { readNotebookBundle } from './notebook_bundle.js';

/// The target platform a shared notebook link points at.
export enum NotebookLinkTarget {
    NATIVE,
    WEB
}

/// Options controlling how a notebook is exported to a ZIP.
export interface NotebookExportOptions {
    /// Include the persisted relation and function catalog SQL files when they exist.
    withCatalog?: boolean;
    /// Transform the notebook metadata after it is loaded from the backend and before it is written
    /// into the ZIP. The script folders and draft are always exported verbatim from disk; only the
    /// `dashql-notebook.json` payload passes through here. The sharing path uses this to sanitize
    /// connection secrets, strip the login hint, or override the name.
    /// Receives the notebook as stored; returns the notebook to serialize.
    transformNotebook?: (notebook: NotebookData) => NotebookData;
}

/// Options applied after sanitizing notebook connection parameters for sharing.
export interface SharedNotebookExportOptions {
    /// Carry the sharer's resolved account username in the shared connection identity.
    withLoginHint?: boolean;
    /// Include persisted relation and function catalog SQL files when present.
    withCatalog?: boolean;
}

type SharedNotebookExportOptionsInput = SharedNotebookExportOptions | boolean;

/// Creates a ZIP file from notebook data and script folders
export async function createNotebookZip(
    notebookData: NotebookData,
    scripts: ScriptData[],
    schemaSql: string | null = null,
    functionsSql: string | null = null,
): Promise<Blob> {
    const zip = new JSZip();

    // Add notebook metadata
    zip.file(STORAGE_NOTEBOOK_FILE, JSON.stringify(notebookData, null, 2));
    if (schemaSql != null) {
        zip.file(STORAGE_SCRIPT_SCHEMA, schemaSql);
    }
    if (functionsSql != null) {
        zip.file(STORAGE_SCRIPT_FUNCTIONS, functionsSql);
    }

    // Add the flat ordered scripts.
    const scriptsFolder = zip.folder(STORAGE_SCRIPTS_FOLDER);
    if (!scriptsFolder) {
        throw new Error('Failed to create scripts folder in ZIP');
    }

    for (const script of scripts) {
        scriptsFolder.file(script.name, script.sql);
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
    const bundle = await readNotebookBundle(notebookId, backend, options.withCatalog ?? false);

    // Apply the caller's notebook transform (sharing sanitization, name override, ...)
    const outNotebook = options.transformNotebook ? options.transformNotebook(bundle.notebook) : bundle.notebook;

    // Create ZIP from loaded data
    return await createNotebookZip(
        outNotebook,
        bundle.scripts,
        bundle.schemaSql,
        bundle.functionsSql,
    );
}

/// Export a notebook as a shareable ZIP.
///
/// Script folders, scripts, the draft and the notebook name are read straight from disk (via
/// `exportNotebookAsZip`) so the shared archive matches the persisted notebook exactly. Only the
/// connection params are rewritten for sharing: the stored params are swapped for the live
/// connection's params, sanitized of secrets, with the login hint optionally stripped.
export async function exportNotebookAsSharedZip(
    backend: StorageBackend,
    notebookId: string,
    databaseParams: ReadonlyMap<string, ConnectionParams>,
    optionsInput: SharedNotebookExportOptionsInput = {},
): Promise<Blob> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    const withLoginHint = options.withLoginHint ?? true;
    return await exportNotebookAsZip(notebookId, backend, {
        withCatalog: options.withCatalog ?? true,
        transformNotebook: (notebook: NotebookData): NotebookData => ({
            ...notebook,
            mainDatabase: {
                ...notebook.mainDatabase,
                params: sanitizeConnectionParamsForSharing(
                    databaseParams.get(notebook.mainDatabase.databaseId) ?? notebook.mainDatabase.params,
                    withLoginHint,
                ),
            },
            attachedDatabases: notebook.attachedDatabases.map(database => ({
                ...database,
                params: sanitizeConnectionParamsForSharing(
                    databaseParams.get(database.databaseId) ?? database.params,
                    withLoginHint,
                ),
            })) as NotebookData['attachedDatabases'],
        }),
    });
}

/// Export a notebook as a shareable link that carries the notebook ZIP inline.
export async function exportNotebookAsUrl(
    backend: StorageBackend,
    notebookId: string,
    databaseParams: any,
    target: NotebookLinkTarget,
    optionsInput: SharedNotebookExportOptionsInput = {},
): Promise<URL> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    const zipBlob = await exportNotebookAsSharedZip(
        backend,
        notebookId,
        databaseParams,
        options,
    );
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
