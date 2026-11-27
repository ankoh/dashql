import type { FileSystem } from './file_system.js';

export type { FileStamp } from './file_system.js';

/// The file system of the desktop app, the preload script of the Electron app exposes it as dashqlElectron.fs.
/// The global declaration of the bridge in packages/dashql-app/types/electron.d.ts refers to this type.
export type ElectronFsBridge = FileSystem;

function bridge(): ElectronFsBridge {
    const electron = (globalThis as { dashqlElectron?: { fs: ElectronFsBridge } }).dashqlElectron;
    if (electron === undefined) throw new Error('Electron filesystem bridge is unavailable');
    return electron.fs;
}

/// The file system of the desktop app. It finds the bridge when it is used, not when it is created.
export const ELECTRON_FILE_SYSTEM: FileSystem = {
    exists: path => bridge().exists(path),
    fileStamp: path => bridge().fileStamp(path),
    listFiles: path => bridge().listFiles(path),
    mkdir: (path, options) => bridge().mkdir(path, options),
    readDir: path => bridge().readDir(path),
    readFile: path => bridge().readFile(path),
    readTextFile: path => bridge().readTextFile(path),
    remove: (path, options) => bridge().remove(path, options),
    rename: (from, to) => bridge().rename(from, to),
    stat: path => bridge().stat(path),
    writeFile: (path, data) => bridge().writeFile(path, data),
    writeTextFile: (path, data) => bridge().writeTextFile(path, data),
};

/// Claim a native workbook folder that the manifest registers for the app, false outside of the desktop app and for a
/// missing folder. Folders registered before the app granted folders are claimed once, later starts reject the claim.
export async function claimElectronWorkbookFolder(nativePath: string): Promise<boolean> {
    const electron = (globalThis as { dashqlElectron?: { claimWorkbookFolder(path: string): Promise<unknown> } }).dashqlElectron;
    if (electron === undefined) return false;
    await electron.claimWorkbookFolder(nativePath);
    return await ELECTRON_FILE_SYSTEM.exists(nativePath);
}
