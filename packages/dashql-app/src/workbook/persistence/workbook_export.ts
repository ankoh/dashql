import type { StorageBackend, WorkbookData, ConnectionParams } from '@ankoh/dashql-sdk/storage/storage_backend';
import { validateDataFileName } from '@ankoh/dashql-sdk/storage/storage_backend';
import { BASE64URL_CODEC } from '@ankoh/dashql-sdk/utils/base64';
import { WORKBOOK_FORMAT_VERSION } from '@ankoh/dashql-sdk/storage/migration/versions';
import { sanitizeConnectionParamsForSharing } from '@ankoh/dashql-sdk/connections/connection_params';
import {
    pruneBundleConnections,
    readWorkbookBundle,
    regenerateBundleConnectionIds,
    type WorkbookBundle,
    type WorkbookBundleResult,
} from '@ankoh/dashql-sdk/storage/workbook_bundle';
import type { DashQL } from '@ankoh/dashql-core';
import { RESULT_TABLE_PREFIX, WORKBOOK_TABLE_NAMES, workbookBundleToTables, type WorkbookTables } from '@ankoh/dashql-sdk/storage/workbook_tables';
import { workbookTableFileName, writeWorkbookTableParquet } from '../../storage/workbook_tables_parquet.js';
import { parseCatalogSql } from '@ankoh/dashql-sdk/connections/catalog/catalog_structure';
import type { WorkbookArchiveWriter } from './workbook_archive_database.js';
import { ZIP_QUERY_PARAMETER } from '../../platform/events/event_listener.js';
import { archiveError, BlobReader, BlobWriter, Uint8ArrayReader, ZipWriter } from './workbook_zip.js';

/// The target platform a shared workbook link points at.
export enum WorkbookLinkTarget {
    NATIVE,
    WEB
}

/// Options controlling how a workbook is exported to a ZIP.
export interface WorkbookExportOptions {
    /// Include the catalogs of the connections of the workbook when they exist.
    withCatalog?: boolean;
    /// Transform the workbook metadata and the catalogs after they are loaded from the backend and
    /// before they are written into the ZIP. Scripts are exported verbatim from disk. The sharing
    /// path uses this to sanitize connection secrets, strip the login hint, or give the workbook and
    /// its connections fresh ids, the catalogs follow their connections.
    transformBundle?: (bundle: Pick<WorkbookBundle, 'workbook' | 'catalogs'>) => Pick<WorkbookBundle, 'workbook' | 'catalogs'>;
    /// The cached query results of the scripts, written as result tables
    queryResults?: readonly WorkbookBundleResult[];
    /// Stops the export, e.g. once its settings changed
    signal?: AbortSignal;
}

/// Options applied after sanitizing workbook connection parameters for sharing.
export interface SharedWorkbookExportOptions {
    /// Carry the sharer's resolved account username in the shared connection identity.
    withLoginHint?: boolean;
    /// Include the catalogs of the connections of the workbook when present.
    withCatalog?: boolean;
    /// Keep the workbook and connection UUIDs instead of generating export-only identities.
    preserveUUIDs?: boolean;
    /// The names the user gave the connections (connectionId -> name), an import names new connections after them.
    connectionNames?: ReadonlyMap<string, string>;
    /// The cached query results of the scripts, only a file carries them, never a link
    queryResults?: readonly WorkbookBundleResult[];
    /// Stops the export, e.g. once its settings changed
    signal?: AbortSignal;
}

type SharedWorkbookExportOptionsInput = SharedWorkbookExportOptions | boolean;

/// The workbook tables of a bundle that leaves the app, in a `.dashql` file or in the cloud: the connection params are
/// sanitized for sharing and the draft script stays behind. The link to a published workbook of the cloud stays as well,
/// whoever imports the workbook links it again (docs/design/cloud.md). The core reads the catalog files of the
/// connections.
export function sharedWorkbookTables(core: DashQL, bundle: WorkbookBundle): WorkbookTables {
    const { cloud: _link, ...metadata } = bundle.workbook.metadata ?? {};
    const sanitized: WorkbookBundle = {
        ...bundle,
        workbook: {
            ...bundle.workbook,
            metadata,
            connections: bundle.workbook.connections.map(connection => ({
                connectionId: connection.connectionId,
                params: sanitizeConnectionParamsForSharing(connection.params),
                ...(connection.name == null ? {} : { name: connection.name }),
            })),
        },
        scripts: bundle.scripts.filter(script => script.name.toLowerCase() !== 'dashql-draft.sql'),
    };
    for (const file of sanitized.data ?? []) validateDataFileName(file.name);
    return workbookBundleToTables(sanitized, sql => parseCatalogSql(core, sql));
}

/// Creates a `.dashql` ZIP from a workbook bundle: the workbook tables as `<table>.parquet`, written with the embedded
/// Hyper, and the Parquet files of the attachment and result tables as they are (docs/design/workbook_tables.md).
/// The archive is streamed into a Blob that the browser keeps, the query results are streamed from their files.
/// The connection params are sanitized for sharing.
export async function createWorkbookZip(
    writer: WorkbookArchiveWriter,
    bundle: WorkbookBundle,
    signal?: AbortSignal,
): Promise<Blob> {
    const tables = sharedWorkbookTables(writer.core, bundle);
    // The signal also stops an entry that is being streamed
    const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 6, signal });
    try {
        // The entries are deflated: Hyper compresses the pages with Snappy, but the footer of a Parquet file is not
        // compressed, and it is most of a small table. Deflate halves the workbook tables and an attachment that Hyper
        // wrote. A query result stays stored, an import reads it in place as a slice of the archive.
        // The entries are added one after the other, concurrent entries would wait in memory.
        // Empty tables are left out, an import reads a missing table as one without rows. The workbook comes first.
        for (const name of WORKBOOK_TABLE_NAMES) {
            const rows = tables[name];
            if (rows.length === 0) continue;
            const bytes = await writeWorkbookTableParquet(writer.database, name, rows as never);
            signal?.throwIfAborted();
            await zip.add(workbookTableFileName(name), new Uint8ArrayReader(bytes));
        }
        for (const [tableName, file] of tables.data) {
            const level = tableName.startsWith(RESULT_TABLE_PREFIX) ? 0 : undefined;
            await zip.add(workbookTableFileName(tableName), new BlobReader(file.bytes), { level });
        }
        return await zip.close();
    } catch (error) {
        await zip.close().catch(() => {});
        throw signal?.aborted ? error : archiveError(error);
    }
}

/// Exports a workbook as a ZIP file by loading from storage backend.
///
/// Scripts are always exported exactly as they exist on disk. The export carries only the connections
/// that the scripts use. Pass `options.transformBundle` to adjust the workbook metadata on the way out
/// (e.g. sanitize connection secrets or drop the login hint when sharing).
export async function exportWorkbookAsZip(
    workbookId: string,
    backend: StorageBackend,
    writer: WorkbookArchiveWriter,
    options: WorkbookExportOptions = {}
): Promise<Blob> {
    return await createWorkbookZip(writer, await readExportedBundle(workbookId, backend, options), options.signal);
}

/// Read the bundle of a workbook that is exported: only the connections that the scripts use, transformed by the
/// caller, with the given query results
async function readExportedBundle(workbookId: string, backend: StorageBackend, options: WorkbookExportOptions): Promise<WorkbookBundle> {
    const bundle = pruneBundleConnections(await readWorkbookBundle(workbookId, backend, options.withCatalog ?? false));
    options.signal?.throwIfAborted();

    // Apply the caller's transform (sharing sanitization, name override, ...)
    const out = options.transformBundle ? options.transformBundle(bundle) : bundle;
    const results = options.queryResults ?? [];
    return {
        ...bundle,
        workbook: out.workbook,
        catalogs: out.catalogs,
        ...(results.length > 0 ? { results: [...results] } : {}),
    };
}

/// Export a workbook as a shareable ZIP.
///
/// Scripts and the workbook name are read straight from disk (via `exportWorkbookAsZip`). Connection
/// params are replaced with their live values and sanitized, the connections carry the given names. By default the exported workbook and
/// connections receive fresh UUIDs so importing a copy cannot collide with existing runtime state.
export async function exportWorkbookAsSharedZip(
    backend: StorageBackend,
    writer: WorkbookArchiveWriter,
    workbookId: string,
    connectionParams: ReadonlyMap<string, ConnectionParams>,
    optionsInput: SharedWorkbookExportOptionsInput = {},
): Promise<Blob> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    return await exportWorkbookAsZip(workbookId, backend, writer, sharedExportOptions(connectionParams, options));
}

/// Export a workbook as the workbook tables of a shared workbook, as exportWorkbookAsSharedZip writes them into a file
export async function exportWorkbookAsSharedTables(
    backend: StorageBackend,
    core: DashQL,
    workbookId: string,
    connectionParams: ReadonlyMap<string, ConnectionParams>,
    options: SharedWorkbookExportOptions = {},
): Promise<WorkbookTables> {
    return sharedWorkbookTables(core, await readExportedBundle(workbookId, backend, sharedExportOptions(connectionParams, options)));
}

/// The export of a shared workbook: the live params of the connections, sanitized, with the names the user gave them
function sharedExportOptions(connectionParams: ReadonlyMap<string, ConnectionParams>, options: SharedWorkbookExportOptions): WorkbookExportOptions {
    const withLoginHint = options.withLoginHint ?? true;
    return {
        withCatalog: options.withCatalog ?? true,
        queryResults: options.queryResults,
        signal: options.signal,
        transformBundle: bundle => {
            const { workbook } = bundle;
            const sanitized: WorkbookData = {
                ...workbook,
                connections: workbook.connections.map(connection => {
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
                ? { ...bundle, workbook: sanitized }
                : regenerateBundleConnectionIds({ ...bundle, workbook: { ...sanitized, workbookId: crypto.randomUUID() } });
        },
    };
}

/// Export a workbook as a shareable link that carries the workbook ZIP inline.
export async function exportWorkbookAsUrl(
    backend: StorageBackend,
    writer: WorkbookArchiveWriter,
    workbookId: string,
    connectionParams: any,
    target: WorkbookLinkTarget,
    optionsInput: SharedWorkbookExportOptionsInput = {},
): Promise<URL> {
    const options = typeof optionsInput === 'boolean' ? { withLoginHint: optionsInput } : optionsInput;
    const zipBlob = await exportWorkbookAsSharedZip(
        backend,
        writer,
        workbookId,
        connectionParams,
        // A link never carries query results, an import of a link adds nothing to the cache
        { ...options, withCatalog: options.withCatalog ?? false, queryResults: undefined },
    );
    return await encodeWorkbookZipAsUrl(zipBlob, target);
}

/// Export a connection as a shareable link: the link carries an empty workbook that holds only the connection.
/// The params are sanitized, the workbook and the connection receive fresh ids.
export async function exportConnectionAsUrl(
    writer: WorkbookArchiveWriter,
    params: ConnectionParams,
    name: string | null,
    target: WorkbookLinkTarget,
    options: Pick<SharedWorkbookExportOptions, 'withLoginHint'> = {},
): Promise<URL> {
    const workbook: WorkbookData = {
        formatVersion: WORKBOOK_FORMAT_VERSION,
        workbookId: crypto.randomUUID(),
        connections: [{
            connectionId: crypto.randomUUID(),
            params: sanitizeConnectionParamsForSharing(params, options.withLoginHint ?? true),
            ...(name == null ? {} : { name }),
        }],
        scripts: [],
        attachments: [],
        metadata: { createdAt: new Date().toISOString() },
    };
    return await encodeWorkbookZipAsUrl(await createWorkbookZip(writer, { workbook, catalogs: [], scripts: [] }), target);
}

/// Encode a workbook ZIP as a link that carries it inline, base64url-encoded once in the `zip` parameter
export async function encodeWorkbookZipAsUrl(zipBlob: Blob, target: WorkbookLinkTarget): Promise<URL> {
    const zip = BASE64URL_CODEC.encode(await zipBlob.arrayBuffer());
    switch (target) {
        case WorkbookLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?${ZIP_QUERY_PARAMETER}=${zip}`);
        case WorkbookLinkTarget.NATIVE:
            return new URL(`dashql://localhost?${ZIP_QUERY_PARAMETER}=${zip}`);
    }
}
