import { open } from '@tauri-apps/plugin-dialog';

import type { Logger } from '../logger/logger.js';
import type { CompositeStorageBackend } from './composite_storage_backend.js';
import { StorageWriter } from './storage_writer.js';

const LOG_CTX = 'storage_migration_flow';

/// Relocate a single OPFS session into a native directory, from the UI (native app only).
///
/// Prompts the user for a target directory, copies just this one session's files into it, verifies
/// the copy, records `location=native` in the OPFS root manifest (the registry entry stays in
/// OPFS), deletes the OPFS copy of the files, and reloads the app to re-run the tested storage init
/// + restore path against the new per-session layout.
///
/// The OPFS copy is never deleted before the native copy is verified and the manifest is updated,
/// so any failure leaves the session fully intact on OPFS.
///
/// Returns false if the user cancelled the folder picker; true after a successful relocate kicks off
/// the reload (the function does not return in practice on success).
export async function relocateSessionToNative(
    sessionId: string,
    backend: CompositeStorageBackend,
    writer: StorageWriter,
    logger: Logger,
): Promise<boolean> {
    // 1. Pick a target directory. recursive:true so the picker's auto-grant also covers nested
    //    notebook/… paths (matters even though the boot path re-grants on reload).
    const folder = await open({
        directory: true,
        multiple: false,
        recursive: true,
        title: 'Select a folder for this session',
    });
    if (folder == null || Array.isArray(folder)) {
        // User cancelled.
        return false;
    }

    try {
        // 2. Stop the debounced writer so OPFS isn't mutated mid-copy, then drain pending writes.
        writer.pause();
        await writer.flush();

        // 3. Copy + verify + flip the registry + delete the OPFS copy.
        await backend.relocateSessionToNative(sessionId, folder);
        logger.info('relocated session to native storage', { sessionId, target: folder }, LOG_CTX);

        // 4. Reload to re-run StorageProvider init + restoreAppState against the new layout.
        globalThis.location.reload();
        return true;
    } catch (e: any) {
        // Re-arm the writer so the app keeps working on OPFS, then surface the failure via the toast.
        writer.resume();
        logger.error('relocating session to native storage failed', {
            sessionId,
            target: folder,
            error: (e as Error)?.message ?? String(e),
        }, LOG_CTX);
        throw e;
    }
}
