import type { DashQL, FlatBufferPtr, buffers } from '@ankoh/dashql-core';
import type { DataFileData, WorkbookData, ScriptData, StorageBackend } from './storage_backend.js';
import {
    isWorkbookRegistryBackend,
    STORAGE_CATALOG_FUNCTIONS,
    STORAGE_CATALOG_RELATIONS,
    STORAGE_CONNECTIONS_FOLDER,
    STORAGE_WORKBOOK_FILE,
    StorageBackendType,
    validateDataFileName,
} from './storage_backend.js';
import type { MigrationFolder } from './migration/migration_folder.js';
import { migrateWorkbookFolder, WorkbookMigrationResult } from './migration/workbook_migration.js';
import { WORKBOOK_CATALOG_COPY_FORMAT_VERSION } from './migration/versions.js';
import {
    describeWorkbookValidationError,
    isValidUuid,
    WorkbookValidationError,
    validateWorkbookData,
} from './workbook_validation.js';
import { reconcileWorkbookScripts, remapWorkbookScripts, sanitizeWorkbookFiles, workbookAttachments, workbookConnectionIdsOf } from './workbook_files.js';

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

/// The path of a catalog file of a connection in a bundle, e.g. `connections/<id>/dashql-catalog-relations.sql`.
/// The app ignores the folder of a workbook folder except when the workbook is imported.
export function bundleCatalogPath(connectionId: string, fileName: string): string {
    return `${STORAGE_CONNECTIONS_FOLDER}/${connectionId}/${fileName}`;
}

/// The format version of the workbook file of a folder, null if it has none
async function readFormatVersion(folder: MigrationFolder): Promise<unknown> {
    return (await readWorkbookField(folder, 'formatVersion')) ?? null;
}

/// Read a top-level field of the workbook file, undefined when the file is unreadable
/// The workbook metadata is read halfway through a migration, when it may still carry the name of the sessions of
/// older versions
async function readWorkbookField(folder: MigrationFolder, field: string): Promise<unknown> {
    try {
        const text = await folder.readText(STORAGE_WORKBOOK_FILE) ?? await folder.readText(LEGACY_SESSION_FILE);
        return text == null ? undefined : (JSON.parse(text) as Record<string, unknown>)?.[field];
    } catch {
        return undefined;
    }
}

/// The name of the workbook metadata up to format version 10
const LEGACY_SESSION_FILE = 'dashql-session.json';

/// Is a path of a bundle the path of a catalog file of a connection?
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

/// Complete a bundle from its top-level files and the files of its folders.
///
/// The file lists of the workbook file are reconciled with the files: scripts without a file are
/// dropped and script files without an entry are appended on the connection of the script before them.
export function assembleWorkbookBundle(
    head: Pick<WorkbookBundle, 'workbook' | 'catalogs'>,
    scripts: ScriptData[],
    data: DataFileData[] = [],
): WorkbookBundle {
    const reconciled = reconcileWorkbookScripts(head.workbook.scripts, scripts.map(script => script.name), firstConnectionId(head.workbook));
    return {
        workbook: {
            ...head.workbook,
            scripts: reconciled.scripts,
            attachments: workbookAttachments(data.map(file => file.name)),
        },
        catalogs: head.catalogs,
        scripts,
        data,
    };
}

/// Reconcile the file lists of a stored workbook file with the stored files, writes the workbook file
/// only when the lists changed. Must not race with writes of the workbook file.
export async function reconcileStoredWorkbookFiles(backend: StorageBackend, workbookId: string): Promise<WorkbookData> {
    const [workbook, scripts, dataFiles] = await Promise.all([
        backend.loadWorkbook(workbookId),
        backend.loadScripts(workbookId),
        backend.listDataFiles(workbookId),
    ]);
    const sanitized = sanitizeWorkbookFiles(workbook);
    const reconciled = reconcileWorkbookScripts(sanitized.scripts, scripts.map(script => script.name), firstConnectionId(workbook));
    const attachments = workbookAttachments(dataFiles.map(file => file.name));
    const next: WorkbookData = { ...workbook, scripts: reconciled.scripts, attachments };
    if (!sanitized.valid || reconciled.changed || !workbookAttachmentsEqual(workbook.attachments, attachments)) {
        await backend.saveWorkbookManifest(workbookId, next);
    }
    return next;
}

/// The first connection of a workbook, script files without an entry run on it when no script precedes them
function firstConnectionId(workbook: WorkbookData): string {
    return workbook.connections[0]?.connectionId ?? '';
}

/// Do two attachment lists name the same files in the same order?
function workbookAttachmentsEqual(a: WorkbookData['attachments'] | undefined, b: WorkbookData['attachments']): boolean {
    return a != null && a.length === b.length && a.every((file, i) => file.name === b[i].name);
}

/// Migrate the top-level files of a workbook to the current format and read them with the catalogs
/// of the connections in `connections/<id>/`.
///
/// The folder is usually held in memory, e.g. the files of an import or an `OverlayFolder` over a
/// folder that must stay untouched. Errors start with `errorPrefix`, e.g. "Invalid ZIP".
export async function readWorkbookBundleHead(folder: MigrationFolder, errorPrefix: string): Promise<WorkbookBundleHead> {
    // Older workbooks copied the catalog of their default connection into the top level of the
    // folder. It is read before the migration removes the copy and the default connection.
    const migration = await migrateWorkbookFolder(folder, WORKBOOK_CATALOG_COPY_FORMAT_VERSION);
    const hasCatalogCopy = migration !== WorkbookMigrationResult.Missing
        && await readFormatVersion(folder) === WORKBOOK_CATALOG_COPY_FORMAT_VERSION;
    const [legacyRelations, legacyFunctions, legacyConnectionId] = !hasCatalogCopy ? [null, null, null] : await Promise.all([
        folder.readText(STORAGE_CATALOG_RELATIONS),
        folder.readText(STORAGE_CATALOG_FUNCTIONS),
        readWorkbookField(folder, 'defaultConnectionId'),
    ]);
    await migrateWorkbookFolder(folder);
    if (migration === WorkbookMigrationResult.Missing) {
        throw new Error(`${errorPrefix}: missing ${STORAGE_WORKBOOK_FILE}`);
    }
    const text = await folder.readText(STORAGE_WORKBOOK_FILE);
    if (text == null) {
        // Metadata of an unsupported version under an older name
        throw new Error(`${errorPrefix}: invalid ${STORAGE_WORKBOOK_FILE}: ${describeWorkbookValidationError(WorkbookValidationError.UnsupportedFormatVersion)}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(`${errorPrefix}: invalid ${STORAGE_WORKBOOK_FILE}`);
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${errorPrefix}: invalid ${STORAGE_WORKBOOK_FILE}`);
    }
    const parsedWorkbook = parsed as WorkbookData;
    const validation = validateWorkbookData(parsedWorkbook);
    if (!validation.ok) {
        throw new Error(`${errorPrefix}: invalid ${STORAGE_WORKBOOK_FILE}: ${describeWorkbookValidationError(validation.error)}`);
    }
    const files = sanitizeWorkbookFiles(parsedWorkbook);
    const workbook: WorkbookData = { ...parsedWorkbook, scripts: files.scripts, attachments: files.attachments };
    const catalogs: WorkbookBundleCatalog[] = [];
    for (const { connectionId } of workbook.connections) {
        const [relations, functions] = await Promise.all([
            folder.readText(bundleCatalogPath(connectionId, STORAGE_CATALOG_RELATIONS)),
            folder.readText(bundleCatalogPath(connectionId, STORAGE_CATALOG_FUNCTIONS)),
        ]);
        if (relations != null || functions != null) {
            catalogs.push({ connectionId, relations, functions });
        } else if (connectionId === (typeof legacyConnectionId === 'string' ? legacyConnectionId : workbook.connections[0].connectionId)
            && (legacyRelations != null || legacyFunctions != null)) {
            catalogs.push({ connectionId, relations: legacyRelations, functions: legacyFunctions });
        }
    }
    return { workbook, catalogs, filesValid: files.valid };
}

export interface WorkbookCatalogValidationResult {
    /// The bundle without the malformed catalog files
    bundle: WorkbookBundle;
    /// The paths of the malformed catalog files in the bundle
    invalidFiles: string[];
}

/// Give the connections of a bundle fresh ids, the scripts and the catalogs follow them
export function regenerateBundleConnectionIds<B extends Pick<WorkbookBundle, 'workbook' | 'catalogs'>>(bundle: B): B {
    const { workbook } = bundle;
    const connectionIds = new Map(workbook.connections.map(connection => [connection.connectionId, crypto.randomUUID()]));
    return {
        ...bundle,
        workbook: {
            ...workbook,
            connections: workbook.connections.map(connection => ({ ...connection, connectionId: connectionIds.get(connection.connectionId)! })),
            scripts: remapWorkbookScripts(workbook.scripts, connectionIds),
        },
        catalogs: renameBundleCatalogs(bundle.catalogs, connectionIds),
    };
}

/// Keep only the connections of a bundle that its scripts use, in the order the scripts first use them,
/// and their catalogs.
/// A workbook without scripts keeps the connection its first script will run on.
export function pruneBundleConnections<B extends Pick<WorkbookBundle, 'workbook' | 'catalogs'>>(bundle: B): B {
    const { workbook } = bundle;
    const used = workbookConnectionIdsOf(workbook.scripts, workbook.connections[0]?.connectionId ?? null);
    const copies = new Map(workbook.connections.map(connection => [connection.connectionId, connection]));
    return {
        ...bundle,
        workbook: { ...workbook, connections: used.flatMap(connectionId => copies.get(connectionId) ?? []) },
        catalogs: bundle.catalogs.filter(catalog => used.includes(catalog.connectionId)),
    };
}

/// Rename the connections of the catalogs of a bundle (connectionId -> new id).
/// Connections that become one keep the first catalog.
export function renameBundleCatalogs(catalogs: readonly WorkbookBundleCatalog[], connectionIds: ReadonlyMap<string, string>): WorkbookBundleCatalog[] {
    const renamed = new Map<string, WorkbookBundleCatalog>();
    for (const catalog of catalogs) {
        const connectionId = connectionIds.get(catalog.connectionId) ?? catalog.connectionId;
        if (!renamed.has(connectionId)) renamed.set(connectionId, { ...catalog, connectionId });
    }
    return [...renamed.values()];
}

/// Parse catalog files on scratch scripts and omit malformed SQL before it can reach storage.
/// Analysis is intentionally excluded: imported catalogs may reference types or objects that are
/// only available once their connection has been restored.
export function filterInvalidWorkbookCatalogs(
    core: DashQL,
    bundle: WorkbookBundle,
): WorkbookCatalogValidationResult {
    const invalidFiles: string[] = [];
    let changed = false;
    const catalogs = bundle.catalogs.map(catalog => {
        const validate = (sql: string | null, fileName: string) => {
            if (sql == null || parsesWithoutErrors(core, sql)) return sql;
            invalidFiles.push(bundleCatalogPath(catalog.connectionId, fileName));
            changed = true;
            return null;
        };
        return {
            ...catalog,
            relations: validate(catalog.relations, STORAGE_CATALOG_RELATIONS),
            functions: validate(catalog.functions, STORAGE_CATALOG_FUNCTIONS),
        };
    });
    return { bundle: changed ? { ...bundle, catalogs } : bundle, invalidFiles };
}

function parsesWithoutErrors(core: DashQL, sql: string): boolean {
    const catalog = core.createCatalog();
    const script = core.createScript(catalog);
    let parsed: FlatBufferPtr<buffers.parser.ParsedScript> | null = null;
    try {
        script.replaceText(sql);
        script.parse();
        parsed = script.getParsed();
        const reader = parsed.read();
        return reader.scannerErrorsLength() === 0 && reader.parserErrorsLength() === 0;
    } catch {
        return false;
    } finally {
        script.destroy();
        catalog.destroy();
    }
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
    const [stored, scripts] = await Promise.all([
        backend.loadWorkbook(workbookId),
        backend.loadScripts(workbookId),
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
    const files = sanitizeWorkbookFiles(stored);
    const workbook: WorkbookData = { ...stored, scripts: files.scripts, attachments: files.attachments };
    return assembleWorkbookBundle({ workbook, catalogs }, scripts, data);
}

/// Write a fully parsed bundle to storage. This is deliberately not a replacement transaction:
/// callers replacing an existing workbook must stage and coordinate that operation separately.
export async function writeWorkbookBundle(
    bundle: WorkbookBundle,
    backend: StorageBackend,
    options: WorkbookBundleWriteOptions = {},
): Promise<string> {
    const validation = validateWorkbookData(bundle.workbook);
    if (!validation.ok) {
        throw new Error(`Invalid source workbook: ${describeWorkbookValidationError(validation.error)}`);
    }
    const workbookId = options.targetWorkbookId ?? bundle.workbook.workbookId;
    if (!isValidUuid(workbookId)) {
        throw new Error(`Invalid target workbook id: ${workbookId}`);
    }
    if (options.targetIsFresh && options.targetWorkbookId == null) {
        throw new Error('targetIsFresh requires an explicit targetWorkbookId');
    }
    for (const file of bundle.data ?? []) validateDataFileName(file.name);

    const workbook: WorkbookData = {
        ...bundle.workbook,
        workbookId,
        scripts: reconcileWorkbookScripts(bundle.workbook.scripts ?? [], bundle.scripts.map(script => script.name),
            firstConnectionId(bundle.workbook)).scripts,
        attachments: workbookAttachments((bundle.data ?? []).map(file => file.name)),
    };
    if (backend.getBackendType() === StorageBackendType.OPFS) {
        delete workbook.workbookPath;
        delete workbook.storageType;
        delete workbook.nativePath;
    }
    if (options.suffixNameWithCopy) {
        const name = workbook.name?.trim();
        if (name) {
            workbook.name = `${name} (copy)`;
        }
    }

    try {
        await backend.saveWorkbookManifest(workbookId, workbook);
        options.onStep?.('scripts');
        for (const script of bundle.scripts) {
            await backend.saveScript(workbookId, script.name, script.sql);
        }
        options.onStep?.('attachments');
        for (const file of bundle.data ?? []) {
            await backend.saveDataFile(workbookId, file.name, file.bytes);
        }
    } catch (error) {
        if (options.targetIsFresh) {
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
    workbookId: string,
): Promise<void> {
    if (!isWorkbookRegistryBackend(backend)) return;
    for (const catalog of bundle.catalogs) {
        const files = [
            [STORAGE_CATALOG_RELATIONS, catalog.relations],
            [STORAGE_CATALOG_FUNCTIONS, catalog.functions],
        ] as const;
        const existing = await Promise.all(files.map(([fileName]) => backend.loadConnectionFile(catalog.connectionId, fileName)));
        if (existing.some(text => text != null)) continue;
        for (const [fileName, text] of files) {
            if (text == null) continue;
            await backend.saveConnectionFile(catalog.connectionId, fileName, text);
        }
    }
}

/// What differs between an expected and an actual bundle, null if nothing. Names the field or file and never a value,
/// a value can be a secret of a connection.
export function describeWorkbookBundleDifference(expected: WorkbookBundle, actual: WorkbookBundle): string | null {
    // The files first, the workbook file lists them
    const names = (files: readonly { name: string }[]) => files.map(file => file.name).join(', ');
    if (names(expected.scripts) !== names(actual.scripts)) {
        return `the scripts differ: expected [${names(expected.scripts)}], found [${names(actual.scripts)}]`;
    }
    const script = expected.scripts.find((script, i) => script.sql !== actual.scripts[i].sql);
    if (script != null) return `the text of the script ${script.name} differs`;
    const expectedData = expected.data ?? [];
    const actualData = actual.data ?? [];
    if (names(expectedData) !== names(actualData)) {
        return `the attachments differ: expected [${names(expectedData)}], found [${names(actualData)}]`;
    }
    const file = expectedData.find((file, i) => file.bytes.byteLength !== actualData[i].bytes.byteLength
        || file.bytes.some((byte, j) => byte !== actualData[i].bytes[j]));
    if (file != null) return `the bytes of the attachment ${file.name} differ`;
    const field = firstDifferentField(expected.workbook, actual.workbook, 'workbook');
    if (field != null) return `${field} differs`;
    if (JSON.stringify(expected.catalogs) !== JSON.stringify(actual.catalogs)) return 'the catalogs differ';
    return workbookBundlesEqual(expected, actual) ? null : 'the bundles differ';
}

/// The path of the first field that differs, null if none. Fields that are undefined are missing, like in JSON.
function firstDifferentField(expected: unknown, actual: unknown, path: string): string | null {
    if (JSON.stringify(expected) === JSON.stringify(actual)) return null;
    if (expected == null || actual == null || typeof expected !== 'object' || typeof actual !== 'object'
        || Array.isArray(expected) !== Array.isArray(actual)) {
        return path;
    }
    const a = expected as Record<string, unknown>;
    const b = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        const difference = firstDifferentField(a[key], b[key], Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`);
        if (difference != null) return difference;
    }
    return `the order of the fields of ${path}`;
}

/// Compare all portable durable content. Used to verify a staged replacement before touching the
/// live workbook UUID.
export function workbookBundlesEqual(a: WorkbookBundle, b: WorkbookBundle): boolean {
    const { data: aData = [], ...aText } = a;
    const { data: bData = [], ...bText } = b;
    return JSON.stringify(aText) === JSON.stringify(bText)
        && aData.length === bData.length
        && aData.every((file, i) => file.name === bData[i].name
            && file.bytes.byteLength === bData[i].bytes.byteLength
            && file.bytes.every((byte, j) => byte === bData[i].bytes[j]));
}
