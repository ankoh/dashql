import type { StorageMigrationStep } from '../storage_migration.js';
import { readManifestJson, writeManifestJson } from '../storage_root.js';

/// The app manifest registers the sessions as `sessions` up to storage version 6, in the order of the
/// sidebar. Version 7 registers them in the session tree: the directories of `sessiontree/` are the
/// folders of the sidebar and each one holds a `dashql-folder.json` with its sessions. The step moves
/// the sessions of the manifest into the folder `My Sessions`, in their order, and drops `sessions`.
export const sessionTree: StorageMigrationStep = {
    version: 7,
    description: 'Move the sessions of the app manifest into the session tree',
    async migrate({ root }) {
        const manifest = await readManifestJson(root);
        if (manifest == null || !('sessions' in manifest)) {
            return;
        }
        const tree = await root.getDirectoryHandle('sessiontree', { create: true });
        const folder = await tree.getDirectoryHandle('My Sessions', { create: true });
        // An interrupted step may have written the tree already, the sessions it registers stay where they are
        const registered = new Set<string>();
        await collectSessionIds(tree, registered);
        const sessions = await readFolderSessions(folder);
        for (const entry of Array.isArray(manifest.sessions) ? manifest.sessions as unknown[] : []) {
            const { path, storageType, nativePath } = (entry ?? {}) as { path?: unknown; storageType?: unknown; nativePath?: unknown };
            if (typeof path !== 'string' || path.length === 0 || registered.has(path)) {
                continue;
            }
            registered.add(path);
            sessions.push({
                path,
                ...(storageType === 'opfs' || storageType === 'native' ? { storageType } : {}),
                ...(typeof nativePath === 'string' ? { nativePath } : {}),
            });
        }
        await writeFolderSessions(tree, await readFolderSessions(tree));
        await writeFolderSessions(folder, sessions);

        const { sessions: _sessions, ...rest } = manifest;
        await writeManifestJson(root, rest);
    },
};

/// The sessions of the folder file of a directory, empty without one
async function readFolderSessions(dir: FileSystemDirectoryHandle): Promise<Record<string, unknown>[]> {
    let text: string;
    try {
        text = await (await (await dir.getFileHandle('dashql-folder.json', { create: false })).getFile()).text();
    } catch (error) {
        if ((error as DOMException).name === 'NotFoundError') return [];
        throw error;
    }
    const sessions = (JSON.parse(text) as { sessions?: unknown })?.sessions;
    return Array.isArray(sessions) ? sessions as Record<string, unknown>[] : [];
}

/// Write the folder file of a directory
async function writeFolderSessions(dir: FileSystemDirectoryHandle, sessions: Record<string, unknown>[]): Promise<void> {
    const writable = await (await dir.getFileHandle('dashql-folder.json', { create: true })).createWritable();
    await writable.write(JSON.stringify({ sessions }, null, 2));
    await writable.close();
}

/// Collect the ids of the sessions that a directory of the tree and its subdirectories register
async function collectSessionIds(dir: FileSystemDirectoryHandle, ids: Set<string>): Promise<void> {
    for (const entry of await readFolderSessions(dir)) {
        if (typeof entry?.path === 'string') ids.add(entry.path);
    }
    for await (const [, handle] of dir.entries()) {
        if (handle.kind === 'directory') await collectSessionIds(handle as FileSystemDirectoryHandle, ids);
    }
}
