import type { NotebookData, ScriptFolderData, StorageBackend } from './storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import {
    describeNotebookValidationError,
    isValidUuid,
    validateNotebookData,
} from './notebook_validation.js';

/// The durable, portable subset of a notebook. Derived cache files and storage-location metadata
/// are intentionally not represented here.
export interface NotebookBundle {
    notebook: NotebookData;
    schemaSql: string | null;
    functionsSql: string | null;
    folders: ScriptFolderData[];
    draftSql: string | null;
}

export interface NotebookBundleWriteOptions {
    /// Destination UUID. When omitted, preserve the source notebook's authoritative UUID.
    targetNotebookId?: string;
    /// Add " (copy)" to a nonblank source name. Intended for an explicit Create-new operation.
    suffixNameWithCopy?: boolean;
    /// The caller guarantees the destination did not exist before this write. Only then may a
    /// failed whole-bundle write remove the destination as rollback.
    targetIsFresh?: boolean;
}

/// Read the portable durable notebook data from a backend. Catalog SQL can be skipped for exports
/// that intentionally omit it; all other durable files are always loaded.
export async function readNotebookBundle(
    notebookId: string,
    backend: StorageBackend,
    withCatalog: boolean = true,
): Promise<NotebookBundle> {
    const [notebook, folders, draftSql, schemaSql, functionsSql] = await Promise.all([
        backend.loadNotebook(notebookId),
        backend.loadScriptFolders(notebookId),
        backend.loadScriptDraft(notebookId),
        withCatalog ? backend.loadNotebookSchema(notebookId) : null,
        withCatalog ? backend.loadNotebookFunctions(notebookId) : null,
    ]);
    return { notebook, schemaSql, functionsSql, folders, draftSql };
}

/// Write a fully parsed bundle to storage. This is deliberately not a replacement transaction:
/// callers replacing an existing notebook must stage and coordinate that operation separately.
export async function writeNotebookBundle(
    bundle: NotebookBundle,
    backend: StorageBackend,
    options: NotebookBundleWriteOptions = {},
): Promise<string> {
    const validation = validateNotebookData(bundle.notebook);
    if (!validation.ok) {
        throw new Error(`Invalid source notebook: ${describeNotebookValidationError(validation.error)}`);
    }
    const notebookId = options.targetNotebookId ?? bundle.notebook.notebookId;
    if (!isValidUuid(notebookId)) {
        throw new Error(`Invalid target notebook id: ${notebookId}`);
    }
    if (options.targetIsFresh && options.targetNotebookId == null) {
        throw new Error('targetIsFresh requires an explicit targetNotebookId');
    }

    const notebook = { ...bundle.notebook, notebookId };
    if (backend.getBackendType() === StorageBackendType.OPFS) {
        delete notebook.notebookPath;
        delete notebook.storageType;
        delete notebook.nativePath;
    }
    if (options.suffixNameWithCopy) {
        const name = notebook.name?.trim();
        if (name) {
            notebook.name = `${name} (copy)`;
        }
    }

    try {
        await backend.saveNotebookManifest(notebookId, notebook);
        if (bundle.schemaSql != null) {
            await backend.saveNotebookSchema(notebookId, bundle.schemaSql);
        }
        if (bundle.functionsSql != null) {
            await backend.saveNotebookFunctions(notebookId, bundle.functionsSql);
        }
        for (const folder of bundle.folders) {
            await backend.createScriptFolder(notebookId, folder.name);
            for (const script of folder.scripts) {
                await backend.saveScript(notebookId, folder.name, script.name, script.sql);
            }
        }
        if (bundle.draftSql != null) {
            await backend.saveScriptDraft(notebookId, bundle.draftSql);
        }
    } catch (error) {
        if (options.targetIsFresh) {
            try {
                await backend.deleteNotebook(notebookId);
            } catch {
                // Preserve the write error when best-effort rollback also fails.
            }
        }
        throw error;
    }

    return notebookId;
}

/// Compare all portable durable content. Used to verify a staged replacement before touching the
/// live notebook UUID.
export function notebookBundlesEqual(a: NotebookBundle, b: NotebookBundle): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
