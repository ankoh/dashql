/// HyperDB mounts the OPFS root of the origin at this path
const HYPER_OPFS_MOUNT = '/mnt/fs';

/// The OPFS folder of the browser tests.
/// They run on the origin of the app, the dev server and the pages deployment serve tests.html next to it.
export const OPFS_TESTS_FOLDER = 'tests';

/// The OPFS folder with the files of the app, null for the OPFS root
let appFolder: string | null = null;

/// Keep the files of the app in an OPFS folder instead of the OPFS root.
/// The browser tests call this before they load a test, so they never touch the files of the app.
export function setOPFSAppFolder(folder: string | null): void {
    appFolder = folder;
}

/// The root of a platform without an origin private file system, null for the one of the browser
let rootProvider: (() => Promise<FileSystemDirectoryHandle>) | null = null;

/// Keep the files of the app in another root with the layout of the origin private file system
/// (docs/design/storage_layout.md), e.g. a folder on disk in Node (`node/node_directory_handle.ts`). The engine of the
/// platform mounts that root at `/mnt/fs` too, so the Hyper paths stay the same.
export function setOPFSRootProvider(provider: (() => Promise<FileSystemDirectoryHandle>) | null): void {
    rootProvider = provider;
}

/// The OPFS directory with the files of the app
export async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
    const root = rootProvider != null ? await rootProvider() : await navigator.storage.getDirectory();
    return appFolder == null ? root : await root.getDirectoryHandle(appFolder, { create: true });
}

/// The Hyper path of the OPFS directory with the files of the app, e.g. `/mnt/fs`.
/// Application paths are relative to this root.
export function hyperOPFSRoot(): string {
    return appFolder == null ? HYPER_OPFS_MOUNT : `${HYPER_OPFS_MOUNT}/${appFolder}`;
}

/// Ask the browser not to evict the origin private file system under storage pressure, it is the only copy of the
/// workbooks of a browser. Whether the browser keeps it, null without a persistent storage.
export async function requestPersistentStorage(): Promise<boolean | null> {
    if (rootProvider != null) return null;
    // A page has `persist`, the module type checks without the DOM
    const storage = navigator.storage as StorageManager & { persist?: () => Promise<boolean> } | undefined;
    return (await storage?.persist?.()) ?? null;
}
