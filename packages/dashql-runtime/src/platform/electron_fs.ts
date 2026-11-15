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
