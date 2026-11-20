import type * as core from '@akohn/dashql';

import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { createStorageRoot } from '@akohn/dashql/platform/storage/storage_root';
import { NativeStorageBackend } from '@akohn/dashql/platform/storage/native_storage_backend';
import { ELECTRON_FILE_SYSTEM } from '@akohn/dashql/platform/electron_fs';
import { getOPFSRoot } from '@akohn/dashql/platform/opfs_root';
import { OPFS_MANIFEST_LOCK } from '@akohn/dashql/platform/storage/opfs_storage_backend';

// The migrations of the storage are steps of the core (`workbook_format::storage_migration`), see
// docs/design/storage_layout.md. The app gives them the origin private file system and the native workbook folders of
// the desktop app, and holds the lock of the manifest meanwhile. They need the core module, but no runtime.

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
/// The app runs this at startup before anything reads the storage. The steps of the core bring the storage root to the
/// current storage version, then every reachable workbook folder to the current workbook format. A fresh storage gets
/// a manifest with the current version. Workbook folders that become reachable later are migrated when they are
/// registered. A storage of a newer app version is refused. Returns what the migration changed.
export async function migrateStorage(
    logger: Logger,
    setupCore: (context: string) => Promise<core.DashQL>,
    root?: FileSystemDirectoryHandle,
): Promise<StorageMigrationSummary> {
    const storageRoot = createStorageRoot(root ?? await getOPFSRoot(), nativeWorkbookFolder);
    const instance = await setupCore('storage_migration');
    const log: core.RuntimePlatform['log'] = (level, message, details, target) => logger[level](message, Object.fromEntries(details), target);
    return await withManifestLock(() => instance.migrateStorage(storageRoot, log));
}
