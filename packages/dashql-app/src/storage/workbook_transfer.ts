import type { Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import type { StorageBackend } from '@ankoh/dashql/platform/storage/storage_backend';

const LOG_CTX = 'workbook_transfer';

/// The result of copying one or more workbooks between backends.
export interface WorkbookTransferResult {
    /// The number of workbooks copied
    workbookCount: number;
    /// The number of files written (workbook file, scripts and data)
    fileCount: number;
}

/// Copy a single workbook's files from `source` to `target`, keyed by the same UUID.
///
/// The UUID is the authoritative identity and is preserved verbatim - nothing is re-prefixed. The
/// workbook file, the flat scripts and the binary data are copied as
/// they are. `source` is left untouched; the caller deletes the source copy only after the copy is
/// verified.
export async function copyWorkbook(
    workbookId: string,
    source: StorageBackend,
    target: StorageBackend,
    logger: Logger,
): Promise<WorkbookTransferResult> {
    let fileCount = 0;

    // Workbook manifest (copied verbatim; workbookId is preserved)
    const workbookData = await source.loadWorkbook(workbookId);
    await target.saveWorkbookManifest(workbookId, workbookData);
    fileCount++;

    for (const script of await source.loadScripts(workbookId)) {
        await target.saveScript(workbookId, script.name, script.sql);
        fileCount++;
    }
    for (const file of await source.listDataFiles(workbookId)) {
        await target.saveDataFile(workbookId, file.name, await source.loadDataFile(workbookId, file.name));
        fileCount++;
    }

    logger.info('copied workbook', { workbookId, files: String(fileCount) }, LOG_CTX);
    return { workbookCount: 1, fileCount };
}

/// Clone a workbook into `target` under a new UUID (always used for OPFS duplicates).
///
/// Rewrites `workbookId`, drops the display-only `workbookPath`, and suffixes a named workbook
/// with " (copy)". The clone references the same connections. Query result cache is not copied. On any write failure the new workbook is
/// deleted so a half-written clone cannot linger in the registry.
export async function cloneWorkbook(
    sourceWorkbookId: string,
    source: StorageBackend,
    target: StorageBackend,
    newWorkbookId: string,
    logger: Logger,
): Promise<WorkbookTransferResult> {
    let fileCount = 0;
    try {
        // The copy shares the connections of its source
        const workbookData = {
            ...(await source.loadWorkbook(sourceWorkbookId)),
            workbookId: newWorkbookId,
        };
        delete workbookData.workbookPath;
        const trimmedName = workbookData.name?.trim();
        if (trimmedName) {
            workbookData.name = `${trimmedName} (copy)`;
        }

        await target.saveWorkbookManifest(newWorkbookId, workbookData);
        fileCount++;

        for (const script of await source.loadScripts(sourceWorkbookId)) {
            await target.saveScript(newWorkbookId, script.name, script.sql);
            fileCount++;
        }
        for (const file of await source.listDataFiles(sourceWorkbookId)) {
            await target.saveDataFile(newWorkbookId, file.name, await source.loadDataFile(sourceWorkbookId, file.name));
            fileCount++;
        }

        logger.info('cloned workbook', {
            sourceWorkbookId,
            workbookId: newWorkbookId,
            files: String(fileCount),
        }, LOG_CTX);
        return { workbookCount: 1, fileCount };
    } catch (error) {
        try {
            await target.deleteWorkbook(newWorkbookId);
        } catch {
            // Preserve the clone error if rollback fails.
        }
        throw error;
    }
}

/// Verify a single workbook was copied completely by re-reading `target`.
///
/// Checks that the target workbook parses with a workbookId and that its per-workbook script count
/// matches the source. Returns false on any mismatch so the caller can abort and keep the source
/// untouched.
export async function verifyWorkbook(workbookId: string, source: StorageBackend, target: StorageBackend): Promise<boolean> {
    let targetData;
    try {
        targetData = await target.loadWorkbook(workbookId);
    } catch {
        return false;
    }
    if (!targetData.workbookId) {
        return false;
    }

    if ((await source.loadScripts(workbookId)).length !== (await target.loadScripts(workbookId)).length) return false;
    try {
        const sourceFiles = await source.listDataFiles(workbookId);
        const targetFiles = await target.listDataFiles(workbookId);
        if (sourceFiles.length !== targetFiles.length) return false;
        for (const file of sourceFiles) {
            const sourceBytes = await source.loadDataFile(workbookId, file.name);
            const targetBytes = await target.loadDataFile(workbookId, file.name);
            if (sourceBytes.length !== targetBytes.length || !sourceBytes.every((byte, i) => byte === targetBytes[i])) return false;
        }
        return true;
    } catch {
        return false;
    }
}
