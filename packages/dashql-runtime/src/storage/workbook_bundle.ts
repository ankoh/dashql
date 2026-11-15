import type { DashQL, WorkbookBundleJson } from '@ankoh/dashql-core';
import type { DataFileData, WorkbookData, ScriptData, StorageBackend } from './storage_backend.js';
import {
    isWorkbookRegistryBackend,
    STORAGE_CATALOG_FUNCTIONS,
    STORAGE_CATALOG_RELATIONS,
    STORAGE_CONNECTIONS_FOLDER,
    STORAGE_WORKBOOK_FILE,
    StorageBackendType,
} from './storage_backend.js';
import type { MigrationFolder } from './migration/migration_folder.js';
import { readCurrentWorkbookFile, readMigrationFiles } from './migration/workbook_migration.js';
import { loadWorkbookFormat, workbookFormat } from './workbook_format.js';

// Workbook bundles are a module of the workbook format of the core (`workbook_format::bundle`). The functions below
// read and write the files, the core decides what a bundle holds, see docs/wip/core_runtime.md.

/// The durable, portable subset of a workbook. Storage-location metadata is intentionally not represented here, and
/// cached query results only when an exported workbook carries them.
export interface WorkbookBundle {
    /// The workbook file. Its script list names every script of `scripts` in feed order and its
    /// attachment list names every file of `data`.
    workbook: WorkbookData;
    /// The catalogs of the connections of the workbook. Workbooks don't store a catalog, bundles carry
    /// the catalogs of their connections so that a connection new to the app starts with one.
    catalogs: WorkbookBundleCatalog[];
    /// The script files
    scripts: ScriptData[];
    /// The attachments
    data?: DataFileData[];
    /// The cached query results that an exported workbook carries, an import adds them to the query result cache of
    /// the app. Never written to the workbook folder.
    results?: WorkbookBundleResult[];
}

/// A cached query result that an exported workbook carries (docs/design/query_cache.md)
export interface WorkbookBundleResult {
    /// The cache key, it covers the connection signature and the script, no ids
    key: string;
    /// The Parquet file: a file of the cache on export, a slice of the archive on import. Both stay on disk until they
    /// are streamed.
    bytes: Blob;
    /// The CRC-32 that the archive stores for the file, checked while an import streams it into the cache
    crc32?: number;
}

/// The catalog of a connection that a bundle carries
export interface WorkbookBundleCatalog {
    /// The connection
    connectionId: string;
    /// The catalog relations
    relations: string | null;
    /// The catalog functions
    functions: string | null;
}

/// Is a path of a bundle the path of a catalog file of a connection, `connections/<id>/dashql-catalog-*.sql`?
export function isBundleCatalogPath(path: string): boolean {
    const parts = path.split('/');
    return parts.length === 3 && parts[0] === STORAGE_CONNECTIONS_FOLDER
        && (parts[2] === STORAGE_CATALOG_RELATIONS || parts[2] === STORAGE_CATALOG_FUNCTIONS);
}

/// The workbook file and the catalogs of a workbook bundle
export interface WorkbookBundleHead extends Pick<WorkbookBundle, 'workbook' | 'catalogs'> {
    /// False when unusable entries were removed from the file lists of the workbook file
    filesValid: boolean;
}

/// Complete a bundle from its workbook file and catalogs and the files of its folders. The file lists of the workbook
/// file follow the files: scripts without a file are dropped and script files without an entry are appended on the
/// connection of the script before them. Needs the core instantiated.
export function assembleWorkbookBundle(
    head: Pick<WorkbookBundle, 'workbook' | 'catalogs'>,
    scripts: ScriptData[],
    data: DataFileData[] = [],
): WorkbookBundle {
    const workbook = workbookFormat().assembleBundle(head.workbook, scripts.map(script => script.name), data.map(file => file.name));
    return { workbook: workbook as WorkbookData, catalogs: head.catalogs, scripts, data };
}

/// Reconcile the file lists of a stored workbook file with the stored files, writes the workbook file
/// only when the lists changed. Must not race with writes of the workbook file.
export async function reconcileStoredWorkbookFiles(backend: StorageBackend, workbookId: string): Promise<WorkbookData> {
    const [workbook, scripts, dataFiles, format] = await Promise.all([
        backend.loadWorkbook(workbookId),
        backend.loadScripts(workbookId),
        backend.listDataFiles(workbookId),
        loadWorkbookFormat(),
    ]);
    const reconciled = format.reconcileStoredFiles(workbook, scripts.map(script => script.name.normalize('NFC')), dataFiles.map(file => file.name.normalize('NFC')));
    const next = reconciled.workbook as WorkbookData;
    if (reconciled.write) {
        await backend.saveWorkbookManifest(workbookId, next);
    }
    return next;
}

/// Migrate the top-level files of a workbook to the current format and read them with the catalogs of the
/// connections in `connections/<id>/`. The folder is only read, e.g. the files of an import or a native folder that
/// must stay untouched. Errors start with `errorPrefix`, e.g. "Invalid ZIP".
export async function readWorkbookBundleHead(folder: MigrationFolder, errorPrefix: string): Promise<WorkbookBundleHead> {
    const format = await loadWorkbookFormat();
    // A current folder needs its workbook file only
    const current = await readCurrentWorkbookFile(folder);
    const files: [string, string][] = current != null
        ? [[STORAGE_WORKBOOK_FILE, current]]
        : await readMigrationFiles(folder, format.constants().migrationFiles);
    let head = format.readBundleHead(files, errorPrefix);
    // The catalogs of the connections, the core names the connections once it migrated the workbook file
    const catalogFiles: [string, string][] = [];
    for (const connection of (head.workbook as WorkbookData).connections) {
        for (const fileName of [STORAGE_CATALOG_RELATIONS, STORAGE_CATALOG_FUNCTIONS]) {
            const path = `${STORAGE_CONNECTIONS_FOLDER}/${connection.connectionId}/${fileName}`;
            const text = await folder.readText(path);
            if (text != null) catalogFiles.push([path, text]);
        }
    }
    if (catalogFiles.length > 0) {
        head = format.readBundleHead([...files, ...catalogFiles], errorPrefix);
    }
    return { workbook: head.workbook as WorkbookData, catalogs: head.catalogs, filesValid: head.filesValid };
}

export interface WorkbookCatalogValidationResult {
    /// The bundle without the malformed catalog files
    bundle: WorkbookBundle;
    /// The paths of the malformed catalog files in the bundle
    invalidFiles: string[];
}

/// Give the connections of a bundle fresh ids, the scripts and the catalogs follow them
export function regenerateBundleConnectionIds<B extends Pick<WorkbookBundle, 'workbook' | 'catalogs'>>(bundle: B): B {
    const { workbook, catalogs } = workbookFormat().regenerateConnectionIds(bundle.workbook, bundle.catalogs);
    return { ...bundle, workbook: workbook as WorkbookData, catalogs };
}

/// Keep only the connections of a bundle that its scripts use, in the order the scripts first use them, and their
/// catalogs. A workbook without scripts keeps the connection its first script will run on.
export function pruneBundleConnections<B extends Pick<WorkbookBundle, 'workbook' | 'catalogs'>>(bundle: B): B {
    const { workbook, catalogs } = workbookFormat().pruneConnections(bundle.workbook, bundle.catalogs);
    return { ...bundle, workbook: workbook as WorkbookData, catalogs };
}

/// Rename the connections of the catalogs of a bundle (connectionId -> new id).
/// Connections that become one keep the first catalog.
export function renameBundleCatalogs(catalogs: readonly WorkbookBundleCatalog[], connectionIds: ReadonlyMap<string, string>): WorkbookBundleCatalog[] {
    return workbookFormat().renameCatalogs(catalogs, Object.fromEntries(connectionIds));
}

/// Parse the catalog files and omit malformed SQL before it can reach storage. Analysis is intentionally excluded:
/// imported catalogs may reference types or objects that are only available once their connection has been restored.
export function filterInvalidWorkbookCatalogs(core: DashQL, bundle: WorkbookBundle): WorkbookCatalogValidationResult {
    const { catalogs, invalidFiles } = core.workbookFormat.filterInvalidCatalogs(bundle.catalogs);
    return { bundle: invalidFiles.length === 0 ? bundle : { ...bundle, catalogs }, invalidFiles };
}

export interface WorkbookBundleWriteOptions {
    /// Destination UUID. When omitted, preserve the source workbook's authoritative UUID.
    targetWorkbookId?: string;
    /// Add " (copy)" to a nonblank source name. Intended for an explicit Create-new operation.
    suffixNameWithCopy?: boolean;
    /// The caller guarantees the destination did not exist before this write. Only then may a
    /// failed whole-bundle write remove the destination as rollback.
    targetIsFresh?: boolean;
    /// Follow the write: the scripts are written, then the attachments
    onStep?: (step: WorkbookBundleWriteStep) => void;
}

/// A step of the write of a bundle, in order
export type WorkbookBundleWriteStep = 'scripts' | 'attachments';

/// Read the portable durable workbook data from a backend. The catalogs of the connections of the
/// workbook are only read for exports that ask for them, and only from a backend that holds the connections.
export async function readWorkbookBundle(
    workbookId: string,
    backend: StorageBackend,
    withCatalog: boolean = false,
): Promise<WorkbookBundle> {
    const [stored, scripts, format] = await Promise.all([
        backend.loadWorkbook(workbookId),
        backend.loadScripts(workbookId),
        loadWorkbookFormat(),
    ]);
    const registry = withCatalog && isWorkbookRegistryBackend(backend) ? backend : null;
    const catalogs: WorkbookBundleCatalog[] = [];
    for (const { connectionId } of registry == null ? [] : stored.connections) {
        const [relations, functions] = await Promise.all([
            registry!.loadConnectionFile(connectionId, STORAGE_CATALOG_RELATIONS),
            registry!.loadConnectionFile(connectionId, STORAGE_CATALOG_FUNCTIONS),
        ]);
        if (relations != null || functions != null) catalogs.push({ connectionId, relations, functions });
    }
    const data = await Promise.all((await backend.listDataFiles(workbookId))
        .map(async file => ({ name: file.name, bytes: await backend.loadDataFile(workbookId, file.name) })));
    const workbook = format.storedBundle(stored, scripts.map(script => script.name), data.map(file => file.name));
    return { workbook: workbook as WorkbookData, catalogs, scripts, data };
}

/// Write a fully parsed bundle to storage. This is deliberately not a replacement transaction:
/// callers replacing an existing workbook must stage and coordinate that operation separately.
export async function writeWorkbookBundle(
    bundle: WorkbookBundle,
    backend: StorageBackend,
    options: WorkbookBundleWriteOptions = {},
): Promise<string> {
    const format = await loadWorkbookFormat();
    const write = format.prepareBundleWrite(
        bundleJson(bundle, { withText: false }),
        backend.getBackendType() === StorageBackendType.OPFS ? 'opfs' : 'native',
        { targetWorkbookId: options.targetWorkbookId, suffixNameWithCopy: options.suffixNameWithCopy, targetIsFresh: options.targetIsFresh },
    );
    const { workbookId } = write;
    try {
        await backend.saveWorkbookManifest(workbookId, write.workbook as WorkbookData);
        options.onStep?.('scripts');
        for (const script of bundle.scripts) {
            await backend.saveScript(workbookId, script.name, script.sql);
        }
        options.onStep?.('attachments');
        for (const file of bundle.data ?? []) {
            await backend.saveDataFile(workbookId, file.name, file.bytes);
        }
    } catch (error) {
        if (write.rollbackOnFailure) {
            try {
                await backend.deleteWorkbook(workbookId);
            } catch {
                // Preserve the write error when best-effort rollback also fails.
            }
        }
        throw error;
    }
    return workbookId;
}

/// Seed the catalogs of the connections from a bundle that was written as workbook `workbookId`.
///
/// A connection that has a catalog keeps it, the catalog of a bundle only describes a connection that
/// is new to the app. Backends without connections are left alone.
export async function seedConnectionCatalogs(
    backend: StorageBackend,
    bundle: Pick<WorkbookBundle, 'workbook' | 'catalogs'>,
    _workbookId: string,
): Promise<void> {
    if (!isWorkbookRegistryBackend(backend)) return;
    const format = await loadWorkbookFormat();
    for (const catalog of bundle.catalogs) {
        const existing = await Promise.all([STORAGE_CATALOG_RELATIONS, STORAGE_CATALOG_FUNCTIONS]
            .map(fileName => backend.loadConnectionFile(catalog.connectionId, fileName)));
        for (const [fileName, text] of format.catalogSeedFiles(catalog, existing.some(text => text != null))) {
            await backend.saveConnectionFile(catalog.connectionId, fileName, text);
        }
    }
}

/// What differs between an expected and an actual bundle, null if nothing. Names the field or file and never a value,
/// a value can be a secret of a connection. Needs the core instantiated.
export function describeWorkbookBundleDifference(expected: WorkbookBundle, actual: WorkbookBundle): string | null {
    const [a, b] = comparableBundles(expected, actual);
    return workbookFormat().bundleDifference(a, b);
}

/// Compare all portable durable content. Used to verify a staged replacement before touching the
/// live workbook UUID. Needs the core instantiated.
export function workbookBundlesEqual(a: WorkbookBundle, b: WorkbookBundle): boolean {
    const [left, right] = comparableBundles(a, b);
    return workbookFormat().bundlesEqual(left, right);
}

/// The JSON of a bundle for the core. The bytes stay with the host, the core sees a token per file.
export function bundleJson(bundle: WorkbookBundle, { withText = true }: { withText?: boolean } = {}, dataToken = (index: number) => `data:${index}`, resultToken = (index: number) => `result:${index}`): WorkbookBundleJson {
    return {
        workbook: bundle.workbook,
        catalogs: bundle.catalogs,
        scripts: bundle.scripts.map(script => ({ name: script.name, sql: withText ? script.sql : '' })),
        data: (bundle.data ?? []).map((file, index) => ({ name: file.name, bytes: dataToken(index) })),
        results: (bundle.results ?? []).map((result, index) => ({
            key: result.key,
            bytes: resultToken(index),
            ...(result.crc32 == null ? {} : { crc32: result.crc32 }),
        })),
    };
}

/// Two bundles for a comparison in the core: equal attachments get equal tokens, results compare by key and checksum
function comparableBundles(expected: WorkbookBundle, actual: WorkbookBundle): [WorkbookBundleJson, WorkbookBundleJson] {
    const expectedData = expected.data ?? [];
    const actualData = actual.data ?? [];
    const sameBytes = (left: Uint8Array, right: Uint8Array) => left.byteLength === right.byteLength && left.every((byte, i) => byte === right[i]);
    const left = bundleJson(expected, {}, index => `data:${index}`, () => 'result');
    const right = bundleJson(actual, {}, index => {
        const other = expectedData[index];
        const file = actualData[index];
        return other != null && file != null && sameBytes(other.bytes, file.bytes) ? `data:${index}` : `actual:${index}`;
    }, () => 'result');
    return [left, right];
}
