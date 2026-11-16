import { getOPFSRoot } from '@akohn/dashql/platform/opfs_root';

export const SHELL_FILES_DIRECTORY = 'imported';

export async function ensureHyperDBOPFSDirectories(
    getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot,
): Promise<void> {
    const root = await getRoot();
    await root.getDirectoryHandle(SHELL_FILES_DIRECTORY, { create: true });
}
