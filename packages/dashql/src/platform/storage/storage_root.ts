import type * as core from '../../core/index.js';

/// The storage root of the app as the migrations of the runtime see it (`RuntimeStorageRoot` of the core): the files
/// and directories of a directory handle by their paths, e.g. the origin private file system of the app or the root of
/// Node. The runtime brings it to the current storage version with `migrateStorage` (docs/design/storage_layout.md).

/// Is an error of the file system API one of a missing entry?
function isNotFound(error: unknown): boolean {
    const name = (error as DOMException | null)?.name;
    return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/// The names of a path, `/` separated, without empty ones
function names(path: string): string[] {
    return path.split('/').filter(name => name.length > 0);
}

/// Copy the files and folders of a directory into another one. Existing files are replaced, or kept.
async function copyDirectory(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle, keepExisting: boolean): Promise<void> {
    for await (const [name, handle] of from.entries()) {
        if (handle.kind === 'directory') {
            await copyDirectory(handle as FileSystemDirectoryHandle, await to.getDirectoryHandle(name, { create: true }), keepExisting);
            continue;
        }
        if (keepExisting) {
            try {
                await to.getFileHandle(name, { create: false });
                continue;
            } catch (error) {
                if (!isNotFound(error)) throw error;
            }
        }
        const content = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer();
        const writable = await (await to.getFileHandle(name, { create: true })).createWritable();
        await writable.write(content);
        await writable.close();
    }
}

/// The storage root over a directory handle. The native workbook folders come from the platform, none without.
export function createStorageRoot(
    root: FileSystemDirectoryHandle,
    nativeFolder: (nativePath: string) => Promise<core.RuntimeFolder | null> = async () => null,
): core.RuntimeStorageRoot {
    /// The directory of a path, null if it doesn't exist
    const directory = async (path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
        let dir = root;
        try {
            for (const name of names(path)) dir = await dir.getDirectoryHandle(name, { create });
            return dir;
        } catch (error) {
            if (!create && isNotFound(error)) return null;
            throw error;
        }
    };
    /// The directory and the name of the entry of a path
    const entry = async (path: string, create: boolean): Promise<[FileSystemDirectoryHandle | null, string]> => {
        const parts = names(path);
        const name = parts.pop() ?? '';
        return [await directory(parts.join('/'), create), name];
    };
    return {
        readText: async path => {
            const [dir, name] = await entry(path, false);
            if (dir == null) return null;
            try {
                return await (await (await dir.getFileHandle(name, { create: false })).getFile()).text();
            } catch (error) {
                if (isNotFound(error)) return null;
                throw error;
            }
        },
        writeText: async (path, text) => {
            const [dir, name] = await entry(path, true);
            const writable = await (await dir!.getFileHandle(name, { create: true })).createWritable();
            await writable.write(text);
            await writable.close();
        },
        createDirectory: async path => {
            await directory(path, true);
        },
        remove: async path => {
            const [dir, name] = await entry(path, false);
            if (dir == null) return;
            try {
                await dir.removeEntry(name, { recursive: true });
            } catch (error) {
                if (!isNotFound(error)) throw error;
            }
        },
        list: async path => {
            const dir = await directory(path, false);
            if (dir == null) return null;
            const entries: { name: string; directory: boolean }[] = [];
            for await (const [name, handle] of dir.entries()) entries.push({ name, directory: handle.kind === 'directory' });
            return entries;
        },
        copyDirectory: async (from, to, keepExisting) => {
            const source = await directory(from, false);
            if (source == null) return;
            await copyDirectory(source, (await directory(to, true))!, keepExisting);
        },
        nativeFolder,
    };
}
