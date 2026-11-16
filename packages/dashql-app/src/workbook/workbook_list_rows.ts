import {
    type WorkbookTreeFolder,
    folderAt,
    folderPathKey,
    isFolderPathWithin,
    sameFolderPath,
} from '@ankoh/dashql/platform/storage/workbook_tree';

/// The id of the drop target at the end of the workbook list, a drop there moves to the end of the root
export const TOP_LEVEL_DROP_ID = 'top-level';

/// A row of the workbook list, a folder or a workbook
export type WorkbookListRow<Item extends { workbookId: string }> =
    | {
        kind: 'folder';
        /// The sortable id
        id: string;
        folder: WorkbookTreeFolder;
        depth: number;
        expanded: boolean;
    }
    | {
        kind: 'workbook';
        /// The sortable id, the workbook id
        id: string;
        item: Item;
        depth: number;
        /// The folder of the workbook
        folderPath: string[];
    };

/// The rows of the workbook list: the subfolders of a folder before its workbooks, the content of a
/// folder only when it is expanded. Workbooks without an item, e.g. invalid ones, are left out.
export function flattenWorkbookListRows<Item extends { workbookId: string }>(
    tree: WorkbookTreeFolder,
    items: ReadonlyMap<string, Item>,
    isExpanded: (folder: WorkbookTreeFolder) => boolean,
): WorkbookListRow<Item>[] {
    const rows: WorkbookListRow<Item>[] = [];
    const visit = (folder: WorkbookTreeFolder, depth: number) => {
        for (const child of folder.folders) {
            const expanded = isExpanded(child);
            rows.push({ kind: 'folder', id: `folder:${folderPathKey(child.path)}`, folder: child, depth, expanded });
            if (expanded) visit(child, depth + 1);
        }
        for (const entry of folder.workbooks) {
            const item = items.get(entry.path);
            if (item != null) rows.push({ kind: 'workbook', id: entry.path, item, depth, folderPath: folder.path });
        }
    };
    visit(tree, 0);
    return rows;
}

/// Where a dragged row would land
export interface WorkbookListDrop {
    /// The folder that receives the row
    folderPath: string[];
    /// The position of a workbook among the workbooks of the folder without it, past the end appends
    index: number;
    /// The row that shows the drop, or TOP_LEVEL_DROP_ID
    targetId: string;
    /// Does the row go into the target, or above or below it?
    position: 'into' | 'before' | 'after';
}

/// Resolve the drop of a dragged row on another row or on the drop target at the end of the list.
///
/// A row dropped on a folder goes into it, a row dropped at the end of the list goes to the end of the root. A
/// workbook dropped on a workbook goes above or below it, in the folder of that workbook; a folder dropped on a
/// workbook goes into the folder of that workbook. Returns null when the drop changes nothing or is not possible,
/// e.g. a folder dropped into itself.
export function resolveWorkbookListDrop<Item extends { workbookId: string }>(
    rows: readonly WorkbookListRow<Item>[],
    tree: WorkbookTreeFolder,
    activeId: string,
    overId: string,
    /// Is the dragged row above the middle of the row it is dropped on?
    aboveMiddle: boolean,
): WorkbookListDrop | null {
    if (activeId === overId) return null;
    const active = rows.find(row => row.id === activeId);
    if (active == null) return null;
    let drop: WorkbookListDrop;
    if (overId === TOP_LEVEL_DROP_ID) {
        drop = { folderPath: [], index: Number.MAX_SAFE_INTEGER, targetId: TOP_LEVEL_DROP_ID, position: 'into' };
    } else {
        const over = rows.find(row => row.id === overId);
        if (over == null) return null;
        if (over.kind === 'folder') {
            drop = { folderPath: over.folder.path, index: Number.MAX_SAFE_INTEGER, targetId: over.id, position: 'into' };
        } else if (active.kind === 'workbook') {
            const siblings = (folderAt(tree, over.folderPath)?.workbooks ?? [])
                .map(entry => entry.path)
                .filter(id => id !== active.item.workbookId);
            const overIndex = siblings.indexOf(over.item.workbookId);
            drop = {
                folderPath: over.folderPath,
                index: aboveMiddle ? overIndex : overIndex + 1,
                targetId: over.id,
                position: aboveMiddle ? 'before' : 'after',
            };
        } else {
            // A folder goes into the folder of the workbook, shown on that folder or at the end of the list
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
    // A workbook that is already in place stays
    const current = folderAt(tree, active.folderPath)?.workbooks.map(entry => entry.path) ?? [];
    const currentIndex = current.indexOf(active.item.workbookId);
    if (sameFolderPath(drop.folderPath, active.folderPath)) {
        const lastIndex = current.length - 1;
        const target = Math.min(drop.index, lastIndex);
        if (target === currentIndex) return null;
    }
    return drop;
}
