import {
    type SessionTreeFolder,
    folderAt,
    folderPathKey,
    isFolderPathWithin,
    sameFolderPath,
} from '../storage/session_tree.js';

/// The id of the drop target at the end of the session list, a drop there moves to the end of the root
export const TOP_LEVEL_DROP_ID = 'top-level';

/// A row of the session list, a folder or a session
export type SessionListRow<Item extends { sessionId: string }> =
    | {
        kind: 'folder';
        /// The sortable id
        id: string;
        folder: SessionTreeFolder;
        depth: number;
        expanded: boolean;
    }
    | {
        kind: 'session';
        /// The sortable id, the session id
        id: string;
        item: Item;
        depth: number;
        /// The folder of the session
        folderPath: string[];
    };

/// The rows of the session list: the subfolders of a folder before its sessions, the content of a
/// folder only when it is expanded. Sessions without an item, e.g. invalid ones, are left out.
export function flattenSessionListRows<Item extends { sessionId: string }>(
    tree: SessionTreeFolder,
    items: ReadonlyMap<string, Item>,
    isExpanded: (folder: SessionTreeFolder) => boolean,
): SessionListRow<Item>[] {
    const rows: SessionListRow<Item>[] = [];
    const visit = (folder: SessionTreeFolder, depth: number) => {
        for (const child of folder.folders) {
            const expanded = isExpanded(child);
            rows.push({ kind: 'folder', id: `folder:${folderPathKey(child.path)}`, folder: child, depth, expanded });
            if (expanded) visit(child, depth + 1);
        }
        for (const entry of folder.sessions) {
            const item = items.get(entry.path);
            if (item != null) rows.push({ kind: 'session', id: entry.path, item, depth, folderPath: folder.path });
        }
    };
    visit(tree, 0);
    return rows;
}

/// Where a dragged row would land
export interface SessionListDrop {
    /// The folder that receives the row
    folderPath: string[];
    /// The position of a session among the sessions of the folder without it, past the end appends
    index: number;
    /// The row that shows the drop, or TOP_LEVEL_DROP_ID
    targetId: string;
    /// Does the row go into the target, or above or below it?
    position: 'into' | 'before' | 'after';
}

/// Resolve the drop of a dragged row on another row or on the drop target at the end of the list.
///
/// A row dropped on a folder goes into it, a row dropped at the end of the list goes to the end of the root. A
/// session dropped on a session goes above or below it, in the folder of that session; a folder dropped on a
/// session goes into the folder of that session. Returns null when the drop changes nothing or is not possible,
/// e.g. a folder dropped into itself.
export function resolveSessionListDrop<Item extends { sessionId: string }>(
    rows: readonly SessionListRow<Item>[],
    tree: SessionTreeFolder,
    activeId: string,
    overId: string,
    /// Is the dragged row above the middle of the row it is dropped on?
    aboveMiddle: boolean,
): SessionListDrop | null {
    if (activeId === overId) return null;
    const active = rows.find(row => row.id === activeId);
    if (active == null) return null;
    let drop: SessionListDrop;
    if (overId === TOP_LEVEL_DROP_ID) {
        drop = { folderPath: [], index: Number.MAX_SAFE_INTEGER, targetId: TOP_LEVEL_DROP_ID, position: 'into' };
    } else {
        const over = rows.find(row => row.id === overId);
        if (over == null) return null;
        if (over.kind === 'folder') {
            drop = { folderPath: over.folder.path, index: Number.MAX_SAFE_INTEGER, targetId: over.id, position: 'into' };
        } else if (active.kind === 'session') {
            const siblings = (folderAt(tree, over.folderPath)?.sessions ?? [])
                .map(entry => entry.path)
                .filter(id => id !== active.item.sessionId);
            const overIndex = siblings.indexOf(over.item.sessionId);
            drop = {
                folderPath: over.folderPath,
                index: aboveMiddle ? overIndex : overIndex + 1,
                targetId: over.id,
                position: aboveMiddle ? 'before' : 'after',
            };
        } else {
            // A folder goes into the folder of the session, shown on that folder or at the end of the list
            drop = over.folderPath.length === 0
                ? { folderPath: [], index: Number.MAX_SAFE_INTEGER, targetId: TOP_LEVEL_DROP_ID, position: 'into' }
                : { folderPath: over.folderPath, index: Number.MAX_SAFE_INTEGER, targetId: `folder:${folderPathKey(over.folderPath)}`, position: 'into' };
        }
    }
    if (active.kind === 'folder') {
        const path = active.folder.path;
        if (isFolderPathWithin(drop.folderPath, path) || sameFolderPath(drop.folderPath, path.slice(0, -1))) return null;
        return drop;
    }
    // A session that is already in place stays
    const current = folderAt(tree, active.folderPath)?.sessions.map(entry => entry.path) ?? [];
    const currentIndex = current.indexOf(active.item.sessionId);
    if (sameFolderPath(drop.folderPath, active.folderPath)) {
        const lastIndex = current.length - 1;
        const target = Math.min(drop.index, lastIndex);
        if (target === currentIndex) return null;
    }
    return drop;
}
