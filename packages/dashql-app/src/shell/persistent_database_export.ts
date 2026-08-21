const HYPERDB_DIRECTORY = 'hyperdb';

export function persistentDatabaseFileName(name: string): string {
    return `${name}.hyper`;
}

export async function readPersistentDatabaseFile(
    name: string,
    getOPFSRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
): Promise<Uint8Array> {
    const root = await getOPFSRoot();
    const directory = await root.getDirectoryHandle(HYPERDB_DIRECTORY, { create: false });
    const handle = await directory.getFileHandle(persistentDatabaseFileName(name), { create: false });
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function listPersistentDatabaseFiles(
    getOPFSRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
): Promise<readonly string[]> {
    try {
        const root = await getOPFSRoot();
        const directory = await root.getDirectoryHandle(HYPERDB_DIRECTORY, { create: false });
        const databases: string[] = [];
        for await (const [fileName, handle] of directory.entries()) {
            if (handle.kind === 'file' && fileName.endsWith('.hyper') && fileName.length > '.hyper'.length) {
                databases.push(fileName.slice(0, -'.hyper'.length));
            }
        }
        return databases.sort((a, b) => a.localeCompare(b));
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return [];
        throw error;
    }
}

export async function deletePersistentDatabaseFile(
    name: string,
    getOPFSRoot: () => Promise<FileSystemDirectoryHandle> = () => navigator.storage.getDirectory(),
): Promise<boolean> {
    try {
        const root = await getOPFSRoot();
        const directory = await root.getDirectoryHandle(HYPERDB_DIRECTORY, { create: false });
        await directory.removeEntry(persistentDatabaseFileName(name));
        return true;
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return false;
        throw error;
    }
}
