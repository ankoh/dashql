import type { StorageBackend, WorkbookData, ConnectionParams } from '../../storage/storage_backend.js';
import {
    bundleJson,
    pruneBundleConnections,
    readWorkbookBundle,
    type WorkbookBundle,
    type WorkbookBundleResult,
} from '../../storage/workbook_bundle.js';
import type { DashQL, DashQLWorkbookFormat } from '@ankoh/dashql-core';
import { bundleDataFiles, workbookTablesOfJson, type WorkbookTableName, type WorkbookTables } from '../../storage/workbook_tables.js';
import { writeWorkbookTableParquet } from '../../storage/workbook_tables_parquet.js';
import type { ParquetExportDatabase } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { archiveError, BlobReader, BlobWriter, Uint8ArrayReader, ZipWriter } from './workbook_zip.js';

// The export of a workbook is planned by the workbook format of the core (`workbook_format::export`): the core
// sanitizes the bundle for sharing, turns it into the workbook tables and names the entries of the archive with their
// compression. The host writes the tables as Parquet with the embedded Hyper and the archive with zip.js.

/// What writes the workbook tables of a `.dashql` file: the embedded database writes the Parquet files, the core reads
/// the catalog files of the connections into their tables and functions
export interface WorkbookArchiveWriter {
    database: ParquetExportDatabase;
    core: DashQL;
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

/// The workbook tables of a bundle that leaves the app, in a `.dashql` file or in the cloud: the connection params are
/// sanitized for sharing and the draft script stays behind. The link to a published workbook of the cloud stays as well,
/// whoever imports the workbook links it again (docs/design/cloud.md). The core reads the catalog files of the
/// connections.
export function sharedWorkbookTables(core: DashQL, bundle: WorkbookBundle): WorkbookTables {
    return workbookTablesOfJson(core.workbookFormat.sharedTables(bundleJson(bundle)), bundleDataFiles(bundle));
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
    const format = writer.core.workbookFormat;
    const json = format.sharedTables(bundleJson(bundle));
    const tables = workbookTablesOfJson(json, bundleDataFiles(bundle));
    // The signal also stops an entry that is being streamed
    const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 6, signal });
    try {
        // The core names the entries: the workbook tables with rows, the workbook first, then the data tables. The
        // tables are deflated: Hyper compresses the pages with Snappy, but the footer of a Parquet file is not
        // compressed, and it is most of a small table. A query result stays stored, an import reads it in place as a
        // slice of the archive. The entries are added one after the other, concurrent entries would wait in memory.
        for (const entry of format.archiveEntries(json)) {
            const level = entry.stored ? 0 : undefined;
            if (entry.table != null) {
                const name = entry.table as WorkbookTableName;
                const bytes = await writeWorkbookTableParquet(writer.database, name, tables[name] as never);
                signal?.throwIfAborted();
                await zip.add(entry.fileName, new Uint8ArrayReader(bytes), { level });
            } else if (entry.data != null) {
                const file = tables.data.get(entry.data);
                if (file == null) throw new Error(`Missing data table: ${entry.data}`);
                await zip.add(entry.fileName, new BlobReader(file.bytes), { level });
            }
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
    options: SharedWorkbookExportOptions = {},
): Promise<Blob> {
    return await exportWorkbookAsZip(workbookId, backend, writer, sharedExportOptions(writer.core.workbookFormat, connectionParams, options));
}

/// Export a workbook as the workbook tables of a shared workbook, as exportWorkbookAsSharedZip writes them into a file
export async function exportWorkbookAsSharedTables(
    backend: StorageBackend,
    core: DashQL,
    workbookId: string,
    connectionParams: ReadonlyMap<string, ConnectionParams>,
    options: SharedWorkbookExportOptions = {},
): Promise<WorkbookTables> {
    return sharedWorkbookTables(core, await readExportedBundle(workbookId, backend, sharedExportOptions(core.workbookFormat, connectionParams, options)));
}

/// The export of a shared workbook: the live params of the connections, sanitized, with the names the user gave them
function sharedExportOptions(format: DashQLWorkbookFormat, connectionParams: ReadonlyMap<string, ConnectionParams>, options: SharedWorkbookExportOptions): WorkbookExportOptions {
    return {
        withCatalog: options.withCatalog ?? true,
        queryResults: options.queryResults,
        signal: options.signal,
        transformBundle: bundle => {
            const { workbook, catalogs } = format.sharedExportHead(bundle.workbook, bundle.catalogs, Object.fromEntries(connectionParams), {
                withLoginHint: options.withLoginHint,
                preserveUUIDs: options.preserveUUIDs,
                connectionNames: options.connectionNames == null ? undefined : Object.fromEntries(options.connectionNames),
            });
            return { ...bundle, workbook: workbook as WorkbookData, catalogs };
        },
    };
}

/// Export a workbook as a shareable link that carries the workbook ZIP inline.
export async function exportWorkbookAsUrl(
    backend: StorageBackend,
    writer: WorkbookArchiveWriter,
    workbookId: string,
    connectionParams: ReadonlyMap<string, ConnectionParams>,
    /// The URL of the app that opens the link, the web app or DESKTOP_APP_LINK_BASE
    linkBase: string,
    options: SharedWorkbookExportOptions = {},
): Promise<URL> {
    const zipBlob = await exportWorkbookAsSharedZip(
        backend,
        writer,
        workbookId,
        connectionParams,
        // A link never carries query results, an import of a link adds nothing to the cache
        { ...options, withCatalog: options.withCatalog ?? false, queryResults: undefined },
    );
    return await encodeWorkbookZipAsUrl(writer.core.workbookFormat, zipBlob, linkBase);
}

/// Export a connection as a shareable link: the link carries an empty workbook that holds only the connection.
/// The params are sanitized, the workbook and the connection receive fresh ids.
export async function exportConnectionAsUrl(
    writer: WorkbookArchiveWriter,
    params: ConnectionParams,
    name: string | null,
    /// The URL of the app that opens the link, the web app or DESKTOP_APP_LINK_BASE
    linkBase: string,
    options: Pick<SharedWorkbookExportOptions, 'withLoginHint'> = {},
): Promise<URL> {
    const workbook = writer.core.workbookFormat.connectionLinkWorkbook(params, name, options.withLoginHint ?? true, new Date().toISOString()) as WorkbookData;
    return await encodeWorkbookZipAsUrl(writer.core.workbookFormat, await createWorkbookZip(writer, { workbook, catalogs: [], scripts: [] }), linkBase);
}

/// Encode a workbook ZIP as a link that carries it inline, base64url-encoded once in the `zip` parameter
async function encodeWorkbookZipAsUrl(format: DashQLWorkbookFormat, zipBlob: Blob, linkBase: string): Promise<URL> {
    return new URL(format.workbookLink(new Uint8Array(await zipBlob.arrayBuffer()), linkBase));
}
