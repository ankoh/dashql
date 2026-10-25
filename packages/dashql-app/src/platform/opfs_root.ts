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

/// The OPFS directory with the files of the app
export async function getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return appFolder == null ? root : await root.getDirectoryHandle(appFolder, { create: true });
}

/// The Hyper path of the OPFS directory with the files of the app, e.g. `/mnt/fs`.
/// Application paths are relative to this root.
export function hyperOPFSRoot(): string {
    return appFolder == null ? HYPER_OPFS_MOUNT : `${HYPER_OPFS_MOUNT}/${appFolder}`;
}
