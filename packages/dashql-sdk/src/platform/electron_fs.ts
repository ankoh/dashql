import { joinPath, type FileStamp, type FileSystem } from './file_system.js';

export type { FileStamp } from './file_system.js';

/// The file system of the desktop app, the preload script of the Electron app exposes it as dashqlElectron.fs.
/// The global declaration of the bridge in packages/dashql-app/types/electron.d.ts refers to this type.
export type ElectronFsBridge = FileSystem;

function bridge(): ElectronFsBridge {
    const electron = (globalThis as { dashqlElectron?: { fs: ElectronFsBridge } }).dashqlElectron;
    if (electron === undefined) throw new Error('Electron filesystem bridge is unavailable');
    return electron.fs;
}

export const exists = (path: string) => bridge().exists(path);
export const fileStamp = (path: string) => bridge().fileStamp(path);
export const listFiles = (path: string) => bridge().listFiles(path);
export const mkdir = (path: string, options?: {recursive?: boolean}) => bridge().mkdir(path, options);
export const readDir = (path: string) => bridge().readDir(path);
export const readFile = (path: string) => bridge().readFile(path);
export const readTextFile = (path: string) => bridge().readTextFile(path);
export const remove = (path: string, options?: {recursive?: boolean}) => bridge().remove(path, options);
export const rename = (from: string, to: string) => bridge().rename(from, to);
export const writeFile = (path: string, data: Uint8Array) => bridge().writeFile(path, data);
export const writeTextFile = (path: string, data: string) => bridge().writeTextFile(path, data);
export const join = async (...parts: string[]) => joinPath(...parts);
export async function stat(path: string) {
    const value = await bridge().stat(path);
    return {...value, mtime: value.mtime === null ? null : new Date(value.mtime)};
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
