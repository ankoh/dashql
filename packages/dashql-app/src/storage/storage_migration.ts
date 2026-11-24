import type * as core from '@akohn/dashql';

import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { copyFolderIntoDirectory, createStorageRoot } from '@akohn/dashql/platform/storage/storage_root';
import { NativeStorageBackend } from '@akohn/dashql/platform/storage/native_storage_backend';
import { ELECTRON_FILE_SYSTEM } from '@akohn/dashql/platform/electron_fs';
import { getOPFSRoot } from '@akohn/dashql/platform/opfs_root';
import { OPFS_MANIFEST_LOCK, OPFS_WORKBOOK_TREE_LOCK } from '@akohn/dashql/platform/storage/opfs_storage_backend';

// The migrations of the storage are steps of the core (`workbook_format::storage_migration`), see
// docs/design/storage_layout.md. The app gives them the origin private file system and the native workbook folders of
// the desktop app, and holds the lock of the manifest meanwhile. They need the core module, but no runtime.

/// What a storage migration changed, with the earlier profiles of the desktop app that merged into the storage
export type StorageMigrationSummary = core.StorageMigrationOutcome & {
    /// The earlier profiles whose workbooks or connections merged into the storage
    mergedProfiles: number;
};

/// Run an operation while holding a lock that the tabs of the app share
async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks != null ? await locks.request(name, fn) : await fn();
}

/// A native workbook folder that the manifest registers, claimed for the app. Folders registered before the app granted
/// folders are claimed once, later starts reject the claim. Null outside of the desktop app and for a missing folder.
async function nativeWorkbookFolder(nativePath: string): Promise<core.RuntimeFolder | null> {
    if (globalThis.dashqlElectron === undefined) return null;
    await globalThis.dashqlElectron.claimWorkbookFolder(nativePath);
    if (!(await ELECTRON_FILE_SYSTEM.exists(nativePath))) return null;
    return new NativeStorageBackend(nativePath, ELECTRON_FILE_SYSTEM);
}

/// Merge the storage of the earlier profiles of the desktop app, which the main process copied out of their user data
/// folders (docs/design/electron.md), oldest first. Each copy is staged below the root and merged by the core, then
/// the main process removes it. A profile that fails stays copied and merges at the next start. Returns the profiles
/// that brought workbooks or connections.
async function mergeLegacyProfiles(
    instance: core.DashQL,
    root: FileSystemDirectoryHandle,
    storageRoot: core.RuntimeStorageRoot,
    log: core.RuntimePlatform['log'],
    logger: Logger,
): Promise<number> {
    const electron = globalThis.dashqlElectron;
    if (electron?.legacyProfiles === undefined) return 0;
    let merged = 0;
    for (const profile of await electron.legacyProfiles()) {
        try {
            // A copy that an earlier start left behind may be partial, the staged folder is copied again
            const staged = instance.stagedProfileFolder(profile.name);
            await storageRoot.remove(staged);
            await copyFolderIntoDirectory(ELECTRON_FILE_SYSTEM, profile.path, root, staged);
            const outcome = await instance.mergeStorage(storageRoot, staged, log);
            if (outcome.workbooks + outcome.connections > 0) merged += 1;
            await electron.legacyProfileMerged(profile.name);
        } catch (error) {
            logger.error("Failed to merge the storage of an earlier profile", { profile: profile.name, error: stringifyError(error) }, "storage_migration");
        }
    }
    return merged;
}

/// Bring the storage of the app to the current version.
///
/// The app runs this at startup before anything reads the storage. The steps of the core bring the storage root to the
/// current storage version, then every reachable workbook folder to the current workbook format. A fresh storage gets
/// a manifest with the current version. Workbook folders that become reachable later are migrated when they are
/// registered. A storage of a newer app version is refused. The desktop app then merges the storage of its earlier
/// profiles. Returns what the migration changed.
export async function migrateStorage(
    logger: Logger,
    setupCore: (context: string) => Promise<core.DashQL>,
    root?: FileSystemDirectoryHandle,
): Promise<StorageMigrationSummary> {
    const opfsRoot = root ?? await getOPFSRoot();
    const storageRoot = createStorageRoot(opfsRoot, nativeWorkbookFolder);
    const instance = await setupCore('storage_migration');
    const log: core.RuntimePlatform['log'] = (level, message, details, target) => logger[level](message, Object.fromEntries(details), target);
    return await withLock(OPFS_MANIFEST_LOCK, () => withLock(OPFS_WORKBOOK_TREE_LOCK, async () => {
        const outcome = await instance.migrateStorage(storageRoot, log);
        const mergedProfiles = await mergeLegacyProfiles(instance, opfsRoot, storageRoot, log, logger);
        return { ...outcome, mergedProfiles };
    }));
}
