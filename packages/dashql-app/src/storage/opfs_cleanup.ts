import {
    STORAGE_ATTACHMENTS_FOLDER,
    STORAGE_CONNECTIONS_FOLDER,
    STORAGE_MANIFEST_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_WORKBOOK_FILE,
    STORAGE_WORKBOOKS_FOLDER,
    STORAGE_SHELL_FOLDER,
    StorageBackendType,
} from '@akohn/dashql/platform/storage/storage_backend';
import { OPFS_MANIFEST_LOCK, OPFS_WORKBOOK_TREE_LOCK } from '@akohn/dashql/platform/storage/opfs_storage_backend';
import { type WorkbookEntry, STORAGE_WORKBOOK_TREE_FOLDER, flattenWorkbookTree, readWorkbookTree } from '@akohn/dashql/platform/storage/workbook_tree';
import type * as core from '@akohn/dashql';
import { SHELL_FILES_DIRECTORY } from '../host/hyperdb/hyperdb_opfs.js';
import {
    HYPER_INSTANCE_LOCK_PREFIX,
    HYPER_INSTANCES_DIRECTORY,
    HYPER_LEGACY_INSTANCE_PREFIX,
    HYPER_LEGACY_LOGS_DIRECTORY,
    HYPER_CLOUDS_DIRECTORY,
    isUuid,
} from '@akohn/dashql/platform/hyperdb/hyperdb_opfs_instance';
import { PARQUET_EXPORT_DIRECTORY } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { RESULTS_FOLDER } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { OPFS_TESTS_FOLDER } from '@akohn/dashql/platform/opfs_root';

/// An OPFS entry that the current app version doesn't use
export interface OPFSCleanupCandidate {
    /// The path segments from the OPFS root
    path: string[];
    /// Is the entry a directory?
    directory: boolean;
    /// Why the entry can be deleted
    reason: string;
    /// The registration that would make the entry used again, checked again before the entry is deleted
    guard: { workbookId: string } | { connectionId: string } | null;
    /// The Web Lock that marks the entry as in use, the entry is only deleted while the lock is free
    lockName: string | null;
}

/// The outcome of a cleanup
export interface OPFSCleanupResult {
    /// The number of deleted entries
    removed: number;
    /// The entries that were kept
    skipped: { path: string; reason: string }[];
}

/// The workbooks that the workbook tree and the connections that the manifest registers, with lower-case ids
interface Registrations {
    /// The workbooks that live in OPFS
    opfsWorkbooks: Set<string>;
    /// The workbooks that live in a native folder, OPFS keeps a mirror of their attachments
    nativeWorkbooks: Set<string>;
    /// The connections
    connections: Set<string>;
}

/// Read the registrations of the manifest and the workbook tree, null without a manifest
function readRegistrations(manifest: ManifestJson | null, workbooks: readonly WorkbookEntry[]): Registrations | null {
    if (manifest == null) return null;
    const registrations: Registrations = { opfsWorkbooks: new Set(), nativeWorkbooks: new Set(), connections: new Set() };
    for (const { path, storageType } of workbooks) {
        (storageType === StorageBackendType.Native ? registrations.nativeWorkbooks : registrations.opfsWorkbooks).add(path.toLowerCase());
    }
    for (const entry of Array.isArray(manifest.connections) ? manifest.connections as unknown[] : []) {
        const { id } = (entry ?? {}) as { id?: unknown };
        if (typeof id === 'string') registrations.connections.add(id.toLowerCase());
    }
    return registrations;
}

/// Is the guarded registration in the manifest? Without a manifest every guarded entry counts as registered.
function isRegistered(guard: OPFSCleanupCandidate['guard'], registrations: Registrations | null): boolean {
    if (guard == null) return false;
    if (registrations == null) return true;
    if ('workbookId' in guard) {
        const id = guard.workbookId.toLowerCase();
        return registrations.opfsWorkbooks.has(id) || registrations.nativeWorkbooks.has(id);
    }
    return registrations.connections.has(guard.connectionId.toLowerCase());
}

/// The entries of a workbook folder in OPFS. The folder of a native workbook only mirrors its attachments.
const OPFS_WORKBOOK_ENTRIES = new Map<string, boolean>([
    [STORAGE_WORKBOOK_FILE, false],
    [STORAGE_SCRIPTS_FOLDER, true],
    [STORAGE_ATTACHMENTS_FOLDER, true],
    [RESULTS_FOLDER, true],
]);
/// A native workbook keeps the mirror of its attachments and its results in the origin private file system
const NATIVE_WORKBOOK_ENTRIES = new Map<string, boolean>([[STORAGE_ATTACHMENTS_FOLDER, true], [RESULTS_FOLDER, true]]);
/// The query result cache of the app up to storage version 9, the storage migration removes it
const LEGACY_QUERY_RESULT_CACHE_DIRECTORY = 'cache';

const UNUSED = 'Not used by this version of DashQL';

/// Find the OPFS entries that the current app version doesn't use.
///
/// The scan compares the OPFS root against the current layout: the manifest, the workbook tree, the
/// registered workbooks and connections, the shell folders, the instance folders of open app windows and the Parquet
/// exports. Everything else was left by earlier app versions, by interrupted operations or by workbooks
/// and connections that are gone. The scan reads directory listings only, it never reads files besides
/// the manifest and the folder files of the workbook tree and only descends into the folders it knows.
export async function findOPFSCleanupCandidates(
    instance: core.DashQL,
    root: FileSystemDirectoryHandle,
    locks: LockManager | null = navigator.locks ?? null,
): Promise<OPFSCleanupCandidate[]> {
    // Without a manifest there is no telling which workbooks and connections are registered, they are left alone
    const registrations = await readRootRegistrations(instance, root);
    // Without Web Locks there is no telling which instance folders are alive, they are left alone
    const heldLocks = locks == null ? null : new Set(((await locks.query()).held ?? []).map(lock => lock.name));
    const candidates: OPFSCleanupCandidate[] = [];
    // The folder where the desktop app stages the storage of its earlier profiles, see storage_migration.ts
    const stagedProfiles = instance.stagedProfileFolder('profile').split('/')[0];
    const add = (path: string[], directory: boolean, reason: string, guard: OPFSCleanupCandidate['guard'] = null, lockName: string | null = null) => {
        candidates.push({ path, directory, reason, guard, lockName });
    };

    for await (const [name, handle] of root.entries()) {
        const directory = handle.kind === 'directory';
        if (name === STORAGE_MANIFEST_FILE && !directory) continue;
        if (!directory) {
            add([name], false, UNUSED);
            continue;
        }
        const dir = handle as FileSystemDirectoryHandle;
        switch (name) {
            case STORAGE_WORKBOOKS_FOLDER:
                if (registrations != null) await scanWorkbooks(dir, registrations, add);
                break;
            case STORAGE_CONNECTIONS_FOLDER:
                if (registrations == null) break;
                for await (const [id, child] of dir.entries()) {
                    if (child.kind !== 'directory') add([name, id], false, UNUSED);
                    else if (!registrations.connections.has(id.toLowerCase())) add([name, id], true, 'Connection that is not registered', { connectionId: id });
                }
                break;
            case HYPER_INSTANCES_DIRECTORY:
                if (heldLocks == null) break;
                for await (const [id, child] of dir.entries()) {
                    const lockName = `${HYPER_INSTANCE_LOCK_PREFIX}${id}`;
                    if (child.kind !== 'directory' || !isUuid(id)) add([name, id], child.kind === 'directory', UNUSED);
                    else if (!heldLocks.has(lockName)) add([name, id], true, 'Database of a closed app window', null, lockName);
                }
                break;
            case PARQUET_EXPORT_DIRECTORY:
                for await (const [id, child] of dir.entries()) {
                    add([name, id], child.kind === 'directory', 'Leftover of an interrupted Parquet export');
                }
                break;
            case LEGACY_QUERY_RESULT_CACHE_DIRECTORY:
                add([name], true, 'Query result cache of an earlier version');
                break;
            case STORAGE_SHELL_FOLDER:
            case SHELL_FILES_DIRECTORY:
            case STORAGE_WORKBOOK_TREE_FOLDER:
            // The databases of clouds keep published workbooks, they go with the connection of their local cloud
            case HYPER_CLOUDS_DIRECTORY:
                break;
            case HYPER_LEGACY_LOGS_DIRECTORY:
                add([name], true, 'Hyper logs of an earlier version');
                break;
            case OPFS_TESTS_FOLDER:
                add([name], true, 'Files of the browser tests');
                break;
            default:
                // The desktop app copies the storage of an earlier profile there again at its next start
                if (name === stagedProfiles) {
                    add([name], true, 'Storage of an earlier profile that did not merge');
                } else if (name.startsWith(HYPER_LEGACY_INSTANCE_PREFIX) && isUuid(name.slice(HYPER_LEGACY_INSTANCE_PREFIX.length))) {
                    if (heldLocks != null && !heldLocks.has(name)) add([name], true, 'Database of an earlier version', null, name);
                } else {
                    add([name], true, UNUSED);
                }
        }
    }
    return candidates.sort((a, b) => a.path.join('/').localeCompare(b.path.join('/'), undefined, { numeric: true }));
}

/// Scan the workbook folders against the registered workbooks
async function scanWorkbooks(
    workbooks: FileSystemDirectoryHandle,
    registrations: Registrations,
    add: (path: string[], directory: boolean, reason: string, guard?: OPFSCleanupCandidate['guard']) => void,
): Promise<void> {
    for await (const [id, handle] of workbooks.entries()) {
        const path = [STORAGE_WORKBOOKS_FOLDER, id];
        if (handle.kind !== 'directory') {
            add(path, false, UNUSED);
            continue;
        }
        const key = id.toLowerCase();
        const native = registrations.nativeWorkbooks.has(key);
        if (!native && !registrations.opfsWorkbooks.has(key)) {
            add(path, true, 'Workbook that is not registered', { workbookId: id });
            continue;
        }
        const expected = native ? NATIVE_WORKBOOK_ENTRIES : OPFS_WORKBOOK_ENTRIES;
        for await (const [name, child] of (handle as FileSystemDirectoryHandle).entries()) {
            const directory = child.kind === 'directory';
            if (expected.get(name) !== directory) {
                add([...path, name], directory, native ? 'Left behind when the workbook moved to a folder' : 'Not part of the current workbook layout');
            } else if (name === STORAGE_SCRIPTS_FOLDER) {
                // Scripts are flat files, script folders are pages of an earlier version
                for await (const [script, entry] of (child as FileSystemDirectoryHandle).entries()) {
                    if (entry.kind === 'directory') add([...path, name, script], true, 'Script folder of an earlier version');
                }
            }
        }
    }
}

/// Delete cleanup candidates.
///
/// The deletion holds the manifest and workbook tree locks and reads the registrations again, a candidate whose workbook or
/// connection was registered in the meantime is kept. A candidate with a lock is only deleted while
/// its lock is free, and files that are still open are kept.
export async function removeOPFSCleanupCandidates(
    instance: core.DashQL,
    root: FileSystemDirectoryHandle,
    candidates: readonly OPFSCleanupCandidate[],
    locks: LockManager | null = navigator.locks ?? null,
): Promise<OPFSCleanupResult> {
    const run = async (): Promise<OPFSCleanupResult> => {
        const registrations = await readRootRegistrations(instance, root);
        const result: OPFSCleanupResult = { removed: 0, skipped: [] };
        for (const candidate of candidates) {
            const path = candidate.path.join('/');
            if (isRegistered(candidate.guard, registrations)) {
                result.skipped.push({ path, reason: 'registered again' });
                continue;
            }
            const failure = candidate.lockName != null && locks != null
                ? await locks.request(candidate.lockName, { ifAvailable: true }, lock => lock == null ? 'in use' : removeEntry(root, candidate))
                : await removeEntry(root, candidate);
            if (failure == null) ++result.removed;
            else result.skipped.push({ path, reason: failure });
        }
        return result;
    };
    // Workbooks are registered in the workbook tree and connections in the manifest, the deletion holds both locks
    return locks != null
        ? await locks.request(OPFS_MANIFEST_LOCK, () => locks.request(OPFS_WORKBOOK_TREE_LOCK, run))
        : await run();
}

/// A manifest as it is stored
type ManifestJson = Record<string, unknown>;

/// Read the manifest of a storage root, null if it has none
async function readManifestJson(root: FileSystemDirectoryHandle): Promise<ManifestJson | null> {
    let text: string;
    try {
        text = await (await (await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false })).getFile()).text();
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return null;
        throw error;
    }
    const manifest: unknown = JSON.parse(text);
    if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`Invalid ${STORAGE_MANIFEST_FILE}: not a JSON object`);
    }
    return manifest as ManifestJson;
}

/// Read the registrations of a storage root
async function readRootRegistrations(instance: core.DashQL, root: FileSystemDirectoryHandle): Promise<Registrations | null> {
    return readRegistrations(await readManifestJson(root), flattenWorkbookTree(await readWorkbookTree(instance, root)));
}

/// Remove an entry, returns why it was kept or null
async function removeEntry(root: FileSystemDirectoryHandle, candidate: OPFSCleanupCandidate): Promise<string | null> {
    try {
        let parent = root;
        for (const name of candidate.path.slice(0, -1)) {
            parent = await parent.getDirectoryHandle(name, { create: false });
        }
        await parent.removeEntry(candidate.path[candidate.path.length - 1], { recursive: candidate.directory });
        return null;
    } catch (error) {
        const name = (error as DOMException)?.name;
        if (name === 'NotFoundError') return null;
        // Browsers report files that are still open with either modification error
        if (name === 'NoModificationAllowedError' || name === 'InvalidModificationError') return 'in use';
        return (error as Error)?.message ?? String(error);
    }
}
