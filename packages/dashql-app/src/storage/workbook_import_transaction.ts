import { StorageBackendType, type WorkbookEntry } from '@ankoh/dashql-runtime/storage/storage_backend';
import {
    assembleWorkbookBundle,
    describeWorkbookBundleDifference,
    seedConnectionCatalogs,
    type WorkbookBundle,
    type WorkbookBundleWriteStep,
} from '@ankoh/dashql-runtime/storage/workbook_bundle';
import {
    type CompositeStorageBackend,
    type WorkbookImportConflict,
    type PreparedNativeWorkbook,
} from './composite_storage_backend.js';

export type { WorkbookImportConflict, PreparedNativeWorkbook } from './composite_storage_backend.js';

export interface WorkbookImportTransactionOptions {
    randomUUID?: () => string;
}

export async function findWorkbookImportConflict(
    backend: CompositeStorageBackend,
    workbookId: string,
): Promise<WorkbookImportConflict | null> {
    return await backend.findWorkbookImportConflict(workbookId);
}

export async function prepareNativeWorkbookImport(
    backend: CompositeStorageBackend,
    dir: string,
): Promise<PreparedNativeWorkbook> {
    return await backend.prepareNativeWorkbook(dir);
}

/// Write a new portable workbook under an explicit UUID and verify every durable field.
export async function writePortableWorkbookFresh(
    backend: CompositeStorageBackend,
    bundle: WorkbookBundle,
    targetWorkbookId: string = bundle.workbook.workbookId,
    onStep?: (step: WorkbookBundleWriteStep) => void,
): Promise<string> {
    const conflict = await backend.findWorkbookImportConflict(targetWorkbookId);
    if (conflict) {
        throw new Error(`Workbook ${conflict.workbookId} is already registered`);
    }

    try {
        await backend.writePortableWorkbookBundle(bundle, targetWorkbookId, true, onStep);
        await verifyPortableBundle(backend, bundle, targetWorkbookId);
        await seedConnectionCatalogs(backend, bundle, targetWorkbookId);
    } catch (error) {
        try {
            await backend.deletePortableWorkbook(targetWorkbookId);
        } catch {
            // Preserve the import failure when best-effort cleanup also fails.
        }
        throw error;
    }
    return targetWorkbookId;
}

/// Replace a registered workbook with a portable OPFS copy using a verified staging UUID.
export async function replaceWorkbookWithPortableBundle(
    backend: CompositeStorageBackend,
    bundle: WorkbookBundle,
    conflict: WorkbookImportConflict,
    options: WorkbookImportTransactionOptions = {},
): Promise<string> {
    const targetWorkbookId = conflict.workbookId;
    requireMatchingSource(bundle, targetWorkbookId);
    const oldEntry = await findManifestEntry(backend, targetWorkbookId);
    // A replacement is also the recovery path for registered workbooks that the current format can
    // no longer read (for example V1 workbooks containing dashql-draft.sql). Keep rollback data when
    // possible, but do not prevent the explicitly confirmed replacement when it is unavailable.
    const oldBundle = await tryReadBundle(backend, targetWorkbookId);
    const stagingId = (options.randomUUID ?? (() => crypto.randomUUID()))();
    if (await backend.findWorkbookImportConflict(stagingId)) {
        throw new Error(`Staging workbook ${stagingId} is already registered`);
    }

    let operationError: unknown = null;
    let targetMutationStarted = false;
    try {
        await backend.writePortableWorkbookBundle(bundle, stagingId, true);
        await verifyPortableBundle(backend, bundle, stagingId);

        // Upsert first to retain the existing manifest position and route subsequent live accesses
        // to OPFS. Deleting the OPFS directory then removes every stale durable/cache file at once.
        await backend.upsertWorkbookEntry({ path: targetWorkbookId, storageType: StorageBackendType.OPFS });
        targetMutationStarted = true;
        await backend.deletePortableWorkbookFiles(targetWorkbookId);
        await backend.writePortableWorkbookBundle(bundle, targetWorkbookId, false);
        await verifyPortableBundle(backend, bundle, targetWorkbookId);
        await seedConnectionCatalogs(backend, bundle, targetWorkbookId);
        return targetWorkbookId;
    } catch (error) {
        operationError = error;
        if (targetMutationStarted) {
            await rollbackPortableReplacement(backend, targetWorkbookId, oldEntry, oldBundle);
        }
        throw error;
    } finally {
        try {
            await backend.deletePortableWorkbook(stagingId);
        } catch (cleanupError) {
            if (operationError == null) {
                throw cleanupError;
            }
        }
    }
}

/// Register a validated selected folder directly, preserving its UUID and all folder/cache contents.
export async function registerNativeWorkbook(
    backend: CompositeStorageBackend,
    prepared: PreparedNativeWorkbook,
): Promise<string> {
    const workbookId = prepared.bundle.workbook.workbookId;
    const conflict = await backend.findWorkbookImportConflict(workbookId);
    if (conflict) {
        throw new Error(`Workbook ${conflict.workbookId} is already registered`);
    }
    await backend.registerPreparedNativeWorkbook(prepared, workbookId);
    return workbookId;
}

/// Replace a registration with a validated selected native folder. User-owned native folders are
/// never changed; an old OPFS directory is removed only after the manifest flip succeeds.
export async function replaceWorkbookWithNativeFolder(
    backend: CompositeStorageBackend,
    prepared: PreparedNativeWorkbook,
    conflict: WorkbookImportConflict,
): Promise<string> {
    const targetWorkbookId = conflict.workbookId;
    requireMatchingSource(prepared.bundle, targetWorkbookId);
    if (conflict.location.type === StorageBackendType.Native
        && conflict.location.nativePath === prepared.dir) {
        return targetWorkbookId;
    }

    const oldEntry = await findManifestEntry(backend, targetWorkbookId);
    let manifestFlipped = false;
    try {
        await backend.registerPreparedNativeWorkbook(prepared, targetWorkbookId);
        manifestFlipped = true;
        if (conflict.location.type === StorageBackendType.OPFS) {
            await backend.deletePortableWorkbookFiles(targetWorkbookId);
        }
        return targetWorkbookId;
    } catch (error) {
        if (manifestFlipped) {
            try {
                await backend.upsertWorkbookEntry(oldEntry);
            } catch {
                // Preserve the replacement error if manifest rollback also fails.
            }
        }
        throw error;
    }
}

async function rollbackPortableReplacement(
    backend: CompositeStorageBackend,
    targetWorkbookId: string,
    oldEntry: WorkbookEntry,
    oldBundle: WorkbookBundle | null,
): Promise<void> {
    await backend.deletePortableWorkbookFiles(targetWorkbookId);
    if (oldEntry.storageType !== StorageBackendType.Native && oldBundle) {
        await backend.writePortableWorkbookBundle(oldBundle, targetWorkbookId, false);
    }
    await backend.upsertWorkbookEntry(oldEntry);
}

async function findManifestEntry(
    backend: CompositeStorageBackend,
    workbookId: string,
): Promise<WorkbookEntry> {
    const entries = await backend.listWorkbooks();
    const entry = entries.find(candidate => candidate.path.toLowerCase() === workbookId.toLowerCase());
    if (!entry) {
        throw new Error(`Workbook ${workbookId} is no longer registered`);
    }
    return { ...entry };
}

async function tryReadBundle(
    backend: CompositeStorageBackend,
    workbookId: string,
): Promise<WorkbookBundle | null> {
    try {
        return await backend.readWorkbookBundle(workbookId);
    } catch {
        return null;
    }
}

async function verifyPortableBundle(
    backend: CompositeStorageBackend,
    source: WorkbookBundle,
    targetWorkbookId: string,
): Promise<void> {
    const expected = byFileName(normalizePortableBundle(source, targetWorkbookId));
    const actual = byFileName(await backend.readPortableWorkbookBundle(targetWorkbookId));
    const difference = describeWorkbookBundleDifference(expected, actual);
    if (difference != null) {
        throw new Error(`Workbook import verification failed for ${targetWorkbookId}: ${difference}`);
    }
}

/// The script and data files of a bundle by name. The order of the scripts is the order of the workbook file, a
/// storage lists the files in an order of its own, e.g. OPFS by name, a bundle from tables in the workbook order.
function byFileName(bundle: WorkbookBundle): WorkbookBundle {
    const compare = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    return assembleWorkbookBundle(bundle, [...bundle.scripts].sort(compare), [...(bundle.data ?? [])].sort(compare));
}

function normalizePortableBundle(bundle: WorkbookBundle, workbookId: string): WorkbookBundle {
    const workbook = { ...bundle.workbook, workbookId };
    delete workbook.workbookPath;
    delete workbook.storageType;
    delete workbook.nativePath;
    // The written workbook lists exactly the written scripts and attachments, the catalog belongs to
    // the connection
    return assembleWorkbookBundle({ workbook, catalogs: [] }, bundle.scripts, bundle.data ?? []);
}

function requireMatchingSource(bundle: WorkbookBundle, targetWorkbookId: string): void {
    if (bundle.workbook.workbookId.toLowerCase() !== targetWorkbookId.toLowerCase()) {
        throw new Error(
            `Source workbook ${bundle.workbook.workbookId} does not match replacement ${targetWorkbookId}`,
        );
    }
}
