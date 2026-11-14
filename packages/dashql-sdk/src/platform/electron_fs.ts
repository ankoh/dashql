/// The size and modification time of a file, they change whenever the file is written
export interface FileStamp {
    size: number;
    mtimeMs: number;
}

/// The file system of the desktop app, the preload script of the Electron app exposes it as dashqlElectron.fs.
/// The global declaration of the bridge in packages/dashql-app/types/electron.d.ts refers to this type.
export interface ElectronFsBridge {
    exists(path: string): Promise<boolean>;
    /// The stamp of a file, null if it does not exist
    fileStamp(path: string): Promise<FileStamp | null>;
    /// The files of a directory with their stamps, empty if the directory does not exist
    listFiles(path: string): Promise<Array<FileStamp & {name: string}>>;
    mkdir(path: string, options?: {recursive?: boolean}): Promise<void>;
    readDir(path: string): Promise<Array<{name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean}>>;
    readFile(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
    remove(path: string, options?: {recursive?: boolean}): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<{size: number; mtime: string | null; isFile: boolean; isDirectory: boolean; isSymlink: boolean}>;
    writeFile(path: string, data: Uint8Array): Promise<void>;
    /// Write a text file, resolves with its new stamp
    writeTextFile(path: string, data: string): Promise<FileStamp>;
}

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
export const join = async (...parts: string[]) => parts.reduce((result, part) => `${result.replace(/[\\/]$/, '')}/${part.replace(/^[\\/]/, '')}`);
export async function stat(path: string) {
    const value = await bridge().stat(path);
    return {...value, mtime: value.mtime === null ? null : new Date(value.mtime)};
}
