import type { Logger } from '../logger/logger.js';
import type { StorageBackend } from './storage_backend.js';

const LOG_CTX = 'storage_migration';

/// The result of copying one or more notebooks between backends.
export interface MigrationResult {
    /// The number of notebooks copied
    notebookCount: number;
    /// The number of files written (manifests + schema + functions + scripts + drafts)
    fileCount: number;
}

/// Copy a single notebook's files from `source` to `target`, keyed by the same UUID.
///
/// The UUID is the authoritative identity and is preserved verbatim - nothing is re-prefixed. The
/// notebook manifest, schema, functions, every script folder + script, and the draft are copied as
/// they are. `source` is left untouched; the caller deletes the source copy only after the copy is
/// verified.
export async function copyNotebook(
    notebookId: string,
    source: StorageBackend,
    target: StorageBackend,
    logger: Logger,
): Promise<MigrationResult> {
    let fileCount = 0;

    // Notebook manifest (copied verbatim; notebookId is preserved)
    const notebookData = await source.loadNotebook(notebookId);
    await target.saveNotebookManifest(notebookId, notebookData);
    fileCount++;

    // Schema
    const schema = await source.loadNotebookSchema(notebookId);
    if (schema != null) {
        await target.saveNotebookSchema(notebookId, schema);
        fileCount++;
    }

    // Functions
    const functions = await source.loadNotebookFunctions(notebookId);
    if (functions != null) {
        await target.saveNotebookFunctions(notebookId, functions);
        fileCount++;
    }

    // Script folders + scripts
    const folders = await source.loadScriptFolders(notebookId);
    for (const folder of folders) {
        await target.createScriptFolder(notebookId, folder.name);
        for (const script of folder.scripts) {
            await target.saveScript(notebookId, folder.name, script.name, script.sql);
            fileCount++;
        }
    }

    // Draft
    const draft = await source.loadScriptDraft(notebookId);
    if (draft != null) {
        await target.saveScriptDraft(notebookId, draft);
        fileCount++;
    }

    logger.info('copied notebook', { notebookId, files: String(fileCount) }, LOG_CTX);
    return { notebookCount: 1, fileCount };
}

/// Verify a single notebook was copied completely by re-reading `target`.
///
/// Checks that the target notebook parses with a notebookId and that its per-notebook script count
/// matches the source. Returns false on any mismatch so the caller can abort and keep the source
/// untouched.
export async function verifyNotebook(notebookId: string, source: StorageBackend, target: StorageBackend): Promise<boolean> {
    let targetData;
    try {
        targetData = await target.loadNotebook(notebookId);
    } catch {
        return false;
    }
    if (!targetData.notebookId) {
        return false;
    }

    const sourceScripts = countScripts(await source.loadScriptFolders(notebookId));
    const targetScripts = countScripts(await target.loadScriptFolders(notebookId));
    return sourceScripts === targetScripts;
}

function countScripts(folders: { scripts: unknown[] }[]): number {
    return folders.reduce((sum, folder) => sum + folder.scripts.length, 0);
}
