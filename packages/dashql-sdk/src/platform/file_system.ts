/// The size and modification time of a file, they change whenever the file is written
export interface FileStamp {
    size: number;
    mtimeMs: number;
}

/// The files of a platform: the desktop app passes the bridge of Electron, Node passes node:fs
export interface FileSystem {
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

/// Join the parts of a path with forward slashes, which every platform accepts
export function joinPath(...parts: string[]): string {
    return parts.reduce((result, part) => `${result.replace(/[\\/]$/, '')}/${part.replace(/^[\\/]/, '')}`);
}
