import { joinPath, type FileSystem } from '../../platform/file_system.js';

/// The top-level files of a workbook folder, as the workbook migrations see them.
///
/// The migrations of the core (`workbook_format::migration`) only touch the top-level files of a workbook folder (the
/// metadata and the catalog files), never the scripts or the attachments. The host reads them into the core and writes
/// back what the migration changed, a folder that must stay untouched (an import, a hosted workbook) is only read.
export interface MigrationFolder {
    /// Does the folder contain the file?
    exists(name: string): Promise<boolean>;
    /// Read a file, null if the folder does not contain it
    readText(name: string): Promise<string | null>;
    /// Write a file
    writeText(name: string, text: string): Promise<void>;
    /// Remove a file, a missing file is ignored
    remove(name: string): Promise<void>;
}

/// A folder in memory, e.g. the top-level files of an import
export class MemoryFolder implements MigrationFolder {
    /// The files by name
    readonly files: Map<string, string>;

    constructor(files: Iterable<[string, string]> = []) {
        this.files = new Map(files);
    }

    async exists(name: string): Promise<boolean> {
        return this.files.has(name);
    }

    async readText(name: string): Promise<string | null> {
        return this.files.get(name) ?? null;
    }

    async writeText(name: string, text: string): Promise<void> {
        this.files.set(name, text);
    }

    async remove(name: string): Promise<void> {
        this.files.delete(name);
    }
}

/// A workbook folder in the Origin Private File System
export class OPFSFolder implements MigrationFolder {
    /// The directory of the workbook
    private readonly dir: FileSystemDirectoryHandle;

    constructor(dir: FileSystemDirectoryHandle) {
        this.dir = dir;
    }

    async exists(name: string): Promise<boolean> {
        try {
            await this.dir.getFileHandle(name, { create: false });
            return true;
        } catch (error) {
            if ((error as DOMException).name === 'NotFoundError' || (error as DOMException).name === 'TypeMismatchError') {
                return false;
            }
            throw error;
        }
    }

    async readText(name: string): Promise<string | null> {
        if (!(await this.exists(name))) {
            return null;
        }
        return await (await (await this.dir.getFileHandle(name)).getFile()).text();
    }

    async writeText(name: string, text: string): Promise<void> {
        const writable = await (await this.dir.getFileHandle(name, { create: true })).createWritable();
        await writable.write(text);
        await writable.close();
    }

    async remove(name: string): Promise<void> {
        if (await this.exists(name)) {
            await this.dir.removeEntry(name);
        }
    }
}

/// A workbook folder in a file system, the one of the desktop app or of Node
export class NativeFolder implements MigrationFolder {
    constructor(
        /// The file system of the folder
        private readonly fs: FileSystem,
        /// The absolute directory of the workbook
        private readonly dir: string,
    ) { }

    async exists(name: string): Promise<boolean> {
        return await this.fs.exists(joinPath(this.dir, name));
    }

    async readText(name: string): Promise<string | null> {
        const path = joinPath(this.dir, name);
        return await this.fs.exists(path) ? await this.fs.readTextFile(path) : null;
    }

    async writeText(name: string, text: string): Promise<void> {
        await this.fs.writeTextFile(joinPath(this.dir, name), text);
    }

    async remove(name: string): Promise<void> {
        const path = joinPath(this.dir, name);
        if (await this.fs.exists(path)) {
            await this.fs.remove(path);
        }
    }
}
