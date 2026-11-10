import { describe, expect, it } from 'vitest';

import { type WorkbookTreeFolder } from '../storage/workbook_tree.js';
import { TOP_LEVEL_DROP_ID, flattenWorkbookListRows, resolveWorkbookListDrop } from './workbook_list_rows.js';

const END = Number.MAX_SAFE_INTEGER;

/// The tree: My Workbooks with a, b and the subfolder acme with c, then the workbooks d and e of the root
const TREE: WorkbookTreeFolder = {
    name: '',
    path: [],
    folders: [{
        name: 'My Workbooks',
        path: ['My Workbooks'],
        folders: [{ name: 'acme', path: ['My Workbooks', 'acme'], folders: [], workbooks: [{ path: 'c' }] }],
        workbooks: [{ path: 'a' }, { path: 'b' }],
    }],
    workbooks: [{ path: 'd' }, { path: 'e' }],
};
const ITEMS = new Map(['a', 'b', 'c', 'd', 'e'].map(workbookId => [workbookId, { workbookId }]));
const ROWS = flattenWorkbookListRows(TREE, ITEMS, () => true);
const MY_WORKBOOKS = 'folder:["My Workbooks"]';
const ACME = 'folder:["My Workbooks","acme"]';

describe('workbook list drops', () => {
    it('lists the subfolders of a folder before its workbooks', () => {
        expect(ROWS.map(row => `${row.depth}:${row.kind === 'folder' ? row.folder.name : row.item.workbookId}`))
            .toEqual(['0:My Workbooks', '1:acme', '2:c', '1:a', '1:b', '0:d', '0:e']);
    });

    it('moves a workbook into a folder that it is dropped on', () => {
        expect(resolveWorkbookListDrop(ROWS, TREE, 'd', MY_WORKBOOKS, true))
            .toEqual({ folderPath: ['My Workbooks'], index: END, targetId: MY_WORKBOOKS, position: 'into' });
        expect(resolveWorkbookListDrop(ROWS, TREE, 'a', ACME, false))
            .toEqual({ folderPath: ['My Workbooks', 'acme'], index: END, targetId: ACME, position: 'into' });
    });

    it('moves a workbook above or below the workbook that it is dropped on', () => {
        expect(resolveWorkbookListDrop(ROWS, TREE, 'a', 'e', true))
            .toEqual({ folderPath: [], index: 1, targetId: 'e', position: 'before' });
        expect(resolveWorkbookListDrop(ROWS, TREE, 'e', 'a', false))
            .toEqual({ folderPath: ['My Workbooks'], index: 1, targetId: 'a', position: 'after' });
        expect(resolveWorkbookListDrop(ROWS, TREE, 'b', 'a', true))
            .toEqual({ folderPath: ['My Workbooks'], index: 0, targetId: 'a', position: 'before' });
    });

    it('moves a row to the end of the top level at the end of the list', () => {
        expect(resolveWorkbookListDrop(ROWS, TREE, 'c', TOP_LEVEL_DROP_ID, false))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
        expect(resolveWorkbookListDrop(ROWS, TREE, ACME, TOP_LEVEL_DROP_ID, false))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
    });

    it('ignores drops that change nothing', () => {
        // The last workbook of the root at the end of the root, its own folder, next to itself
        expect(resolveWorkbookListDrop(ROWS, TREE, 'e', TOP_LEVEL_DROP_ID, false)).toBeNull();
        expect(resolveWorkbookListDrop(ROWS, TREE, 'b', MY_WORKBOOKS, false)).toBeNull();
        expect(resolveWorkbookListDrop(ROWS, TREE, 'a', 'b', true)).toBeNull();
        expect(resolveWorkbookListDrop(ROWS, TREE, 'a', 'a', true)).toBeNull();
    });

    it('moves a folder into the folder of the row that it is dropped on, never into itself', () => {
        expect(resolveWorkbookListDrop(ROWS, TREE, ACME, 'd', true))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
        expect(resolveWorkbookListDrop(ROWS, TREE, MY_WORKBOOKS, ACME, true)).toBeNull();
        expect(resolveWorkbookListDrop(ROWS, TREE, MY_WORKBOOKS, 'c', true)).toBeNull();
        expect(resolveWorkbookListDrop(ROWS, TREE, ACME, 'a', true)).toBeNull();
    });
});
