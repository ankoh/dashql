import type { StorageMigrationStep } from '../storage_migration.js';
import { readManifestJson, writeManifestJson } from '../storage_root.js';
import { copyDirectory } from './v2_notebooks_to_sessions.js';

/// The file of a folder of the tree, it lists the entries of the folder
const FOLDER_FILE = 'dashql-folder.json';

/// The directory of the root, null if it doesn't exist
async function findDirectory(root: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle | null> {
    try {
        return await root.getDirectoryHandle(name, { create: false });
    } catch (error) {
        if ((error as DOMException).name !== 'NotFoundError') throw error;
        return null;
    }
}

/// Move a directory of the root to another name, the content is copied and the source removed after it.
/// A target of an interrupted migration is completed.
async function moveDirectory(root: FileSystemDirectoryHandle, from: string, to: string): Promise<void> {
    const source = await findDirectory(root, from);
    if (source == null) return;
    await copyDirectory(source, await root.getDirectoryHandle(to, { create: true }));
    await root.removeEntry(from, { recursive: true });
}

/// Rename the entry list of the folder files of a tree, `sessions` becomes `workbooks`
async function renameFolderEntries(dir: FileSystemDirectoryHandle): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') {
            await renameFolderEntries(handle as FileSystemDirectoryHandle);
            continue;
        }
        if (name !== FOLDER_FILE) continue;
        const file = handle as FileSystemFileHandle;
        let data: unknown;
        try {
            data = JSON.parse(await (await file.getFile()).text());
        } catch {
            continue;
        }
        if (data == null || typeof data !== 'object' || Array.isArray(data) || !('sessions' in data) || 'workbooks' in data) {
            continue;
        }
        const { sessions: workbooks, ...rest } = data as Record<string, unknown>;
        const writable = await file.createWritable();
        await writable.write(JSON.stringify({ workbooks, ...rest }, null, 2));
        await writable.close();
    }
}

/// Sessions are called workbooks: the folders move from `sessions/<uuid>` to `workbooks/<uuid>`, the tree from
/// `sessiontree/` to `workbooktree/` and its folder files list `workbooks` instead of `sessions`. The setting of the
/// sessions that agents may access becomes `agentWorkbooks`. The files inside the folders are renamed by the workbook
/// migration.
///
/// A directory is removed only after it was copied completely, the manifest is rewritten last.
export const sessionsToWorkbooks: StorageMigrationStep = {
    version: 9,
    description: 'Rename sessions as workbooks',
    async migrate({ root }) {
        await moveDirectory(root, 'sessions', 'workbooks');
        await moveDirectory(root, 'sessiontree', 'workbooktree');
        const tree = await findDirectory(root, 'workbooktree');
        if (tree != null) await renameFolderEntries(tree);

        const manifest = await readManifestJson(root);
        const settings = manifest?.appSettings;
        if (manifest != null && settings != null && typeof settings === 'object' && !Array.isArray(settings) && 'agentSessions' in settings) {
            const { agentSessions: agentWorkbooks, ...rest } = settings as Record<string, unknown>;
            await writeManifestJson(root, { ...manifest, appSettings: { ...rest, agentWorkbooks } });
        }
    },
};
