// Moves and copies of the files of directory handles: the origin private file system, or a folder of the host in Node

/// Is an error of the file system API one of a missing entry?
export function isNotFound(error: unknown): boolean {
    const name = (error as DOMException | null)?.name;
    return name === 'NotFoundError' || name === 'TypeMismatchError';
}

/// `move(directory, name)` of the file handles: not every browser has it, and WebKit doesn't take the name alone
type MovableFileHandle = FileSystemFileHandle & { move?(directory: FileSystemDirectoryHandle, name: string): Promise<void> };

/// Move a file between or within directories, byte for byte. Where the browser can't move files, the file is copied
/// and the source removed.
export async function moveFile(
    fromDir: FileSystemDirectoryHandle,
    fromName: string,
    toDir: FileSystemDirectoryHandle,
    toName: string,
): Promise<void> {
    if (fromDir === toDir && fromName === toName) return;
    const handle = (await fromDir.getFileHandle(fromName, { create: false })) as MovableFileHandle;
    if (typeof handle.move === 'function') {
        await handle.move(toDir, toName);
        return;
    }
    const writable = await (await toDir.getFileHandle(toName, { create: true })).createWritable();
    await writable.write(await handle.getFile());
    await writable.close();
    await fromDir.removeEntry(fromName);
}

/// Copy the files and folders of a directory into another one. Existing files are replaced, or kept.
export async function copyDirectory(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle, keepExisting = false): Promise<void> {
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
        const writable = await (await to.getFileHandle(name, { create: true })).createWritable();
        await writable.write(await (handle as FileSystemFileHandle).getFile());
        await writable.close();
    }
}
