import type * as core from '../../core/index.js';
import type { Logger } from '../logger/logger.js';
import { claimElectronWorkbookFolder, ELECTRON_FILE_SYSTEM } from '../electron_fs.js';
import { getOPFSRoot } from '../opfs_root.js';
import { createStorageRoot } from './storage_root.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { OPFS_MANIFEST_LOCK } from './opfs_storage_backend.js';

// The migrations of the storage are steps of the core (`workbook_format::storage_migration`), see
// docs/design/storage_layout.md. The platform gives them the origin private file system and the native workbook folders
// of the desktop app, and holds the lock of the manifest meanwhile. They need the core module, but no runtime.

/// What a storage migration changed
export type StorageMigrationSummary = core.StorageMigrationOutcome;

/// Run an operation while holding the manifest lock, which the tabs of an origin share
async function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks != null ? await locks.request(OPFS_MANIFEST_LOCK, fn) : await fn();
}

/// A native workbook folder that the manifest registers, claimed for the app. Null outside of the desktop app and for a
/// missing folder.
async function nativeWorkbookFolder(nativePath: string): Promise<core.RuntimeFolder | null> {
    if (!(await claimElectronWorkbookFolder(nativePath))) return null;
    return new NativeStorageBackend(nativePath, ELECTRON_FILE_SYSTEM);
}

/// Bring the storage of a page to the current version.
///
/// A page runs this at startup before anything reads the storage, a fresh storage needs it too. The steps of the core
/// bring the storage root to the current storage version, then every reachable workbook folder to the current workbook
/// format. A fresh storage gets a manifest with the current version. Workbook folders that become reachable later are
/// migrated when they are registered. A storage of a newer version is refused. Returns what the migration changed.
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
