import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import type { StorageBackend, SessionData, ScriptData, DataFileData, ConnectionParams } from '../../storage/storage_backend.js';
import {
    STORAGE_SESSION_FILE,
    STORAGE_ATTACHMENTS_FOLDER,
    validateDataFileName,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_CATALOG_FUNCTIONS,
    STORAGE_CATALOG_RELATIONS,
} from '../../storage/storage_backend.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';
import { SESSION_FORMAT_VERSION } from '../../storage/migration/versions.js';
import { sanitizeConnectionParamsForSharing } from '../../connections/connection_params.js';
import {
    bundleCatalogPath,
    pruneBundleConnections,
    readSessionBundle,
    regenerateBundleConnectionIds,
    type SessionBundle,
    type SessionBundleCatalog,
    type SessionBundleResult,
} from '../../storage/session_bundle.js';
import { sessionResultPath } from './session_query_results.js';
import { archiveError, BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from './session_zip.js';

/// The target platform a shared session link points at.
export enum SessionLinkTarget {
    NATIVE,
    WEB
}

/// Options controlling how a session is exported to a ZIP.
export interface SessionExportOptions {
    /// Include the catalogs of the connections of the session when they exist.
    withCatalog?: boolean;
    /// Transform the session metadata and the catalogs after they are loaded from the backend and
    /// before they are written into the ZIP. Scripts are exported verbatim from disk. The sharing
    /// path uses this to sanitize connection secrets, strip the login hint, or give the session and
    /// its connections fresh ids, the catalogs follow their connections.
    transformBundle?: (bundle: Pick<SessionBundle, 'session' | 'catalogs'>) => Pick<SessionBundle, 'session' | 'catalogs'>;
    /// The cached query results of the scripts, written to `results/<key>.parquet`
    queryResults?: readonly SessionBundleResult[];
    /// Stops the export, e.g. once its settings changed
    signal?: AbortSignal;
}

/// Options applied after sanitizing session connection parameters for sharing.
export interface SharedSessionExportOptions {
    /// Carry the sharer's resolved account username in the shared connection identity.
    withLoginHint?: boolean;
    /// Include the catalogs of the connections of the session when present.
    withCatalog?: boolean;
    /// Keep the session and connection UUIDs instead of generating export-only identities.
    preserveUUIDs?: boolean;
    /// The names the user gave the connections (connectionId -> name), an import names new connections after them.
    connectionNames?: ReadonlyMap<string, string>;
    /// The cached query results of the scripts, only a file carries them, never a link
    queryResults?: readonly SessionBundleResult[];
    /// Stops the export, e.g. once its settings changed
    signal?: AbortSignal;
}

type SharedSessionExportOptionsInput = SharedSessionExportOptions | boolean;

/// Creates a ZIP file from session data and script folders. The archive is streamed into a Blob that the browser
/// keeps, the query results are streamed from their files.
export async function createSessionZip(
    sessionData: SessionData,
    scripts: ScriptData[],
    catalogs: readonly SessionBundleCatalog[] = [],
    data: readonly DataFileData[] = [],
    results: readonly SessionBundleResult[] = [],
    signal?: AbortSignal,
): Promise<Blob> {
    // The signal also stops an entry that is being streamed
    const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 6, signal });
    // The entries are added one after the other, concurrent entries would wait in memory
    const text = async (path: string, value: string) => { await zip.add(path, new TextReader(value)); };
    try {
        // Add session metadata
        await text(STORAGE_SESSION_FILE, JSON.stringify({
            ...sessionData,
            connections: sessionData.connections.map(connection => ({
                connectionId: connection.connectionId,
                params: sanitizeConnectionParamsForSharing(connection.params),
                ...(connection.name == null ? {} : { name: connection.name }),
            })),
        }, null, 2));
        // The catalogs of the connections, an import seeds the connections that are new to the app
        for (const catalog of catalogs) {
            if (catalog.relations != null) await text(bundleCatalogPath(catalog.connectionId, STORAGE_CATALOG_RELATIONS), catalog.relations);
            if (catalog.functions != null) await text(bundleCatalogPath(catalog.connectionId, STORAGE_CATALOG_FUNCTIONS), catalog.functions);
        }
        // Add the flat ordered scripts
        for (const script of scripts) {
            if (script.name.toLowerCase() === 'dashql-draft.sql') continue;
            await text(`${STORAGE_SCRIPTS_FOLDER}/${script.name}`, script.sql);
        }
        for (const file of data) {
            validateDataFileName(file.name);
            await zip.add(`${STORAGE_ATTACHMENTS_FOLDER}/${file.name}`, new Uint8ArrayReader(file.bytes));
        }
        // Parquet is compressed already, a stored entry is a plain slice of the archive that an import reads in place
        for (const result of results) {
            await zip.add(sessionResultPath(result.key), new BlobReader(result.bytes), { level: 0 });
        }
        return await zip.close();
    } catch (error) {
        await zip.close().catch(() => {});
        throw signal?.aborted ? error : archiveError(error);
    }
}

/// Exports a session as a ZIP file by loading from storage backend.
///
/// Scripts are always exported exactly as they exist on disk. The export carries only the connections
/// that the scripts use. Pass `options.transformBundle` to adjust the session metadata on the way out
/// (e.g. sanitize connection secrets or drop the login hint when sharing).
export async function exportSessionAsZip(
    sessionId: string,
    backend: StorageBackend,
    options: SessionExportOptions = {}
): Promise<Blob> {
    const bundle = pruneBundleConnections(await readSessionBundle(sessionId, backend, options.withCatalog ?? false));
    options.signal?.throwIfAborted();

    // Apply the caller's transform (sharing sanitization, name override, ...)
    const out = options.transformBundle ? options.transformBundle(bundle) : bundle;
    // Create ZIP from loaded data
    return await createSessionZip(out.session, bundle.scripts, out.catalogs, bundle.data, options.queryResults, options.signal);
}

/// Export a session as a shareable ZIP.
///
/// Scripts and the session name are read straight from disk (via `exportSessionAsZip`). Connection
/// params are replaced with their live values and sanitized, the connections carry the given names. By default the exported session and
/// connections receive fresh UUIDs so importing a copy cannot collide with existing runtime state.
export async function exportSessionAsSharedZip(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: ReadonlyMap<string, ConnectionParams>,
    optionsInput: SharedSessionExportOptionsInput = {},
): Promise<Blob> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    const withLoginHint = options.withLoginHint ?? true;
    return await exportSessionAsZip(sessionId, backend, {
        withCatalog: options.withCatalog ?? true,
        queryResults: options.queryResults,
        signal: options.signal,
        transformBundle: bundle => {
            const { session } = bundle;
            const sanitized: SessionData = {
                ...session,
                connections: session.connections.map(connection => {
                    const name = options.connectionNames?.get(connection.connectionId);
                    return {
                        ...connection,
                        params: sanitizeConnectionParamsForSharing(
                            connectionParams.get(connection.connectionId) ?? connection.params,
                            withLoginHint,
                        ),
                        ...(name == null ? {} : { name }),
                    };
                }),
            };
            return options.preserveUUIDs
                ? { ...bundle, session: sanitized }
                : regenerateBundleConnectionIds({ ...bundle, session: { ...sanitized, sessionId: crypto.randomUUID() } });
        },
    });
}

/// Export a session as a shareable link that carries the session ZIP inline.
export async function exportSessionAsUrl(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: any,
    target: SessionLinkTarget,
    optionsInput: SharedSessionExportOptionsInput = {},
): Promise<URL> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    const zipBlob = await exportSessionAsSharedZip(
        backend,
        sessionId,
        connectionParams,
        // A link never carries query results, an import of a link adds nothing to the cache
        { ...options, withCatalog: options.withCatalog ?? false, queryResults: undefined },
    );
    return await encodeSessionZipAsUrl(zipBlob, target);
}

/// Export a connection as a shareable link: the link carries an empty session that holds only the connection.
/// The params are sanitized, the session and the connection receive fresh ids.
export async function exportConnectionAsUrl(
    params: ConnectionParams,
    name: string | null,
    target: SessionLinkTarget,
    options: Pick<SharedSessionExportOptions, 'withLoginHint'> = {},
): Promise<URL> {
    const session: SessionData = {
        formatVersion: SESSION_FORMAT_VERSION,
        sessionId: crypto.randomUUID(),
        connections: [{
            connectionId: crypto.randomUUID(),
            params: sanitizeConnectionParamsForSharing(params, options.withLoginHint ?? true),
            ...(name == null ? {} : { name }),
        }],
        scripts: [],
        attachments: [],
        metadata: { createdAt: new Date().toISOString() },
    };
    return await encodeSessionZipAsUrl(await createSessionZip(session, []), target);
}

/// Encode a session ZIP as a link that carries it inline.
async function encodeSessionZipAsUrl(zipBlob: Blob, target: SessionLinkTarget): Promise<URL> {
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
