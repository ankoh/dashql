import type { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import type { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';

const LOG_CTX = 'workbook_relocation';

/// Relocate a single OPFS workbook into a native directory, from the UI (native app only).
///
/// Prompts the user for a target directory, copies just this one workbook's files into it, verifies
/// the copy, records `location=native` in the OPFS root manifest (the registry entry stays in
/// OPFS), deletes the OPFS copy of the files, and reloads the app to re-run the tested storage init
/// + restore path against the new per-workbook layout.
///
/// The OPFS copy is never deleted before the native copy is verified and the manifest is updated,
/// so any failure leaves the workbook fully intact on OPFS.
///
/// Returns false if the user cancelled the folder picker; true after a successful relocate kicks off
/// the reload (the function does not return in practice on success).
export async function relocateWorkbookToNative(
    workbookId: string,
    backend: CompositeStorageBackend,
    writer: StorageWriter,
    logger: Logger,
): Promise<boolean> {
    // 1. Pick a target directory. recursive:true so the picker's auto-grant also covers nested
    //    scripts/… paths (matters even though the boot path re-grants on reload).
    const folder = await globalThis.dashqlElectron?.openDirectory('Select a folder for this workbook');
    if (folder == null) {
        // User cancelled.
        return false;
    }

    try {
        // 2. Stop the debounced writer so OPFS isn't mutated mid-copy, then drain pending writes.
        writer.pause();
        await writer.flush();

        // 3. Copy + verify + flip the registry + delete the OPFS copy.
        await backend.relocateWorkbookToNative(workbookId, folder);
        logger.info('relocated workbook to native storage', { workbookId, target: folder }, LOG_CTX);

        // 4. Reload to re-run StorageProvider init + restoreAppState against the new layout.
        globalThis.location.reload();
        return true;
    } catch (e: any) {
        // Re-arm the writer so the app keeps working on OPFS, then surface the failure via the toast.
        writer.resume();
        logger.error('relocating workbook to native storage failed', {
            workbookId,
            target: folder,
            error: (e as Error)?.message ?? String(e),
        }, LOG_CTX);
        throw e;
    }
}

/// Add a pre-existing workbook from a folder on disk, from the UI (native app only).
///
/// Prompts the user for a folder that already holds a dashql workbook (e.g. one created by a previous
/// run, or relocated to native storage), registers it in the OPFS root manifest as a native workbook,
/// and reloads the app so the tested storage init + restore path brings it into the registries.
///
/// Nothing is copied or written into the folder — the folder is the source of truth and stays put.
/// On any failure (folder holds no workbook, invalid metadata, already registered) nothing is changed.
///
/// Returns false if the user cancelled the folder picker; true after a successful load kicks off the
/// reload (the function does not return in practice on success).
export async function addNativeWorkbookFromFolder(
    backend: CompositeStorageBackend,
    logger: Logger,
): Promise<boolean> {
    // recursive:true so the picker's auto-grant also covers the workbook's nested scripts/… paths.
    const folder = await globalThis.dashqlElectron?.openDirectory('Open an existing workbook folder');
    if (folder == null) {
        // User cancelled.
        return false;
    }

    try {
        // Loading only touches the OPFS manifest (no per-workbook writes the writer could race),
        // so unlike relocate there's no need to pause/flush the writer here.
        const workbookId = await backend.loadNativeWorkbook(folder);
        logger.info('added native workbook from folder', { workbookId, folder }, LOG_CTX);

        // Reload to re-run StorageProvider init + restoreAppState, which loads the new workbook.
        globalThis.location.reload();
        return true;
    } catch (e: any) {
        logger.error('adding native workbook from folder failed', {
            folder,
            error: (e as Error)?.message ?? String(e),
        }, LOG_CTX);
        throw e;
    }
}
