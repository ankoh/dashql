import type * as core from '@ankoh/dashql';

import type { Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import { createRuntime } from '@ankoh/dashql/runtime/runtime';
import { TASK_UPDATE_SCHEDULER } from '@ankoh/dashql/runtime/store/store';
import { createStorageRoot } from '@ankoh/dashql/platform/storage/storage_root';
import { NativeStorageBackend } from '@ankoh/dashql/platform/storage/native_storage_backend';
import { ELECTRON_FILE_SYSTEM } from '@ankoh/dashql/platform/platform/electron_fs';
import { getOPFSRoot } from '@ankoh/dashql/platform/platform/opfs_root';
import { OPFS_MANIFEST_LOCK } from '../opfs_storage_backend.js';

// The migrations of the storage are steps of the runtime of the core (`workbook_format::storage_migration`), see
// docs/design/storage_layout.md. The app gives them the origin private file system and the native workbook folders of
// the desktop app, and holds the lock of the manifest meanwhile.

/// What a storage migration changed
export type StorageMigrationSummary = core.StorageMigrationOutcome;

/// Run an operation while holding the manifest lock, which the tabs of the app share
async function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks != null ? await locks.request(OPFS_MANIFEST_LOCK, fn) : await fn();
}

/// A native workbook folder that the manifest registers, claimed for the app. Folders registered before the app granted
/// folders are claimed once, later starts reject the claim. Null outside of the desktop app and for a missing folder.
async function nativeWorkbookFolder(nativePath: string): Promise<core.RuntimeFolder | null> {
    if (globalThis.dashqlElectron === undefined) return null;
    await globalThis.dashqlElectron.claimWorkbookFolder(nativePath);
    if (!(await ELECTRON_FILE_SYSTEM.exists(nativePath))) return null;
    return new NativeStorageBackend(nativePath, ELECTRON_FILE_SYSTEM);
}

/// Bring the storage of the app to the current version.
///
/// The app runs this at startup before anything reads the storage, on a runtime of its own. The steps of the runtime
/// bring the storage root to the current storage version, then every reachable workbook folder to the current workbook
/// format. Workbook folders that become reachable later are migrated when they are registered. A storage of a newer
/// app version is refused. Returns what the migration changed.
export async function migrateStorage(
    logger: Logger,
    setupCore: (context: string) => Promise<core.DashQL>,
    root?: FileSystemDirectoryHandle,
): Promise<StorageMigrationSummary> {
    const storageRoot = createStorageRoot(root ?? await getOPFSRoot(), nativeWorkbookFolder);
    const runtime = createRuntime({ logger, scheduler: TASK_UPDATE_SCHEDULER, setupCore, storageRoot });
    try {
        return await withManifestLock(() => runtime.migrateStorage());
    } finally {
        await runtime.destroy();
    }
}
