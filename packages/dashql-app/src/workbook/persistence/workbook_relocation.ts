import type { Logger } from '@akohn/dashql/platform/logger/logger';
import type { CompositeStorageBackend } from '@akohn/dashql/platform/storage/composite_storage_backend';
import type { StorageCommands } from '@akohn/dashql/runtime/runtime_storage';

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
    writer: StorageCommands,
    logger: Logger,
): Promise<boolean> {
    // 1. Pick a target directory. recursive:true so the picker's auto-grant also covers nested
    //    scripts/… paths (matters even though the boot path re-grants on reload).
    const folder = await globalThis.dashqlElectron?.openDirectory('Select a folder for this workbook');
    if (folder == null) {
        // User cancelled.
        return false;
    }

    // 2. Write the pending edits of the workbook. A write that failed or that a hold keeps would be lost with the OPFS
    //    copy, the workbook is not moved then.
    if (!(await writer.flushWorkbook(workbookId))) {
        throw new Error('The changes of the workbook are not saved yet, it is not moved');
    }
    try {
        // 3. Stop the writer so OPFS isn't mutated mid-copy, then copy + verify + flip the registry + delete the OPFS
        //    copy.
        writer.pause();
        await backend.relocateWorkbookToNative(workbookId, folder);
        logger.info('relocated workbook to native storage', { workbookId, target: folder }, LOG_CTX);

        // 4. Reload to re-run the StorageProvider init and the restore of the runtime against the new layout.
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
