import { describe, expect, it } from 'vitest';

import { type SessionTreeFolder } from '../storage/session_tree.js';
import { TOP_LEVEL_DROP_ID, flattenSessionListRows, resolveSessionListDrop } from './session_list_rows.js';

const END = Number.MAX_SAFE_INTEGER;

/// The tree: My Sessions with a, b and the subfolder acme with c, then the sessions d and e of the root
const TREE: SessionTreeFolder = {
    name: '',
    path: [],
    folders: [{
        name: 'My Sessions',
        path: ['My Sessions'],
        folders: [{ name: 'acme', path: ['My Sessions', 'acme'], folders: [], sessions: [{ path: 'c' }] }],
        sessions: [{ path: 'a' }, { path: 'b' }],
    }],
    sessions: [{ path: 'd' }, { path: 'e' }],
};
const ITEMS = new Map(['a', 'b', 'c', 'd', 'e'].map(sessionId => [sessionId, { sessionId }]));
const ROWS = flattenSessionListRows(TREE, ITEMS, () => true);
const MY_SESSIONS = 'folder:["My Sessions"]';
const ACME = 'folder:["My Sessions","acme"]';

describe('session list drops', () => {
    it('lists the subfolders of a folder before its sessions', () => {
        expect(ROWS.map(row => `${row.depth}:${row.kind === 'folder' ? row.folder.name : row.item.sessionId}`))
            .toEqual(['0:My Sessions', '1:acme', '2:c', '1:a', '1:b', '0:d', '0:e']);
    });

    it('moves a session into a folder that it is dropped on', () => {
        expect(resolveSessionListDrop(ROWS, TREE, 'd', MY_SESSIONS, true))
            .toEqual({ folderPath: ['My Sessions'], index: END, targetId: MY_SESSIONS, position: 'into' });
        expect(resolveSessionListDrop(ROWS, TREE, 'a', ACME, false))
            .toEqual({ folderPath: ['My Sessions', 'acme'], index: END, targetId: ACME, position: 'into' });
    });

    it('moves a session above or below the session that it is dropped on', () => {
        expect(resolveSessionListDrop(ROWS, TREE, 'a', 'e', true))
            .toEqual({ folderPath: [], index: 1, targetId: 'e', position: 'before' });
        expect(resolveSessionListDrop(ROWS, TREE, 'e', 'a', false))
            .toEqual({ folderPath: ['My Sessions'], index: 1, targetId: 'a', position: 'after' });
        expect(resolveSessionListDrop(ROWS, TREE, 'b', 'a', true))
            .toEqual({ folderPath: ['My Sessions'], index: 0, targetId: 'a', position: 'before' });
    });

    it('moves a row to the end of the top level at the end of the list', () => {
        expect(resolveSessionListDrop(ROWS, TREE, 'c', TOP_LEVEL_DROP_ID, false))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
        expect(resolveSessionListDrop(ROWS, TREE, ACME, TOP_LEVEL_DROP_ID, false))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
    });

    it('ignores drops that change nothing', () => {
        // The last session of the root at the end of the root, its own folder, next to itself
        expect(resolveSessionListDrop(ROWS, TREE, 'e', TOP_LEVEL_DROP_ID, false)).toBeNull();
        expect(resolveSessionListDrop(ROWS, TREE, 'b', MY_SESSIONS, false)).toBeNull();
        expect(resolveSessionListDrop(ROWS, TREE, 'a', 'b', true)).toBeNull();
        expect(resolveSessionListDrop(ROWS, TREE, 'a', 'a', true)).toBeNull();
    });

    it('moves a folder into the folder of the row that it is dropped on, never into itself', () => {
        expect(resolveSessionListDrop(ROWS, TREE, ACME, 'd', true))
            .toEqual({ folderPath: [], index: END, targetId: TOP_LEVEL_DROP_ID, position: 'into' });
        expect(resolveSessionListDrop(ROWS, TREE, MY_SESSIONS, ACME, true)).toBeNull();
        expect(resolveSessionListDrop(ROWS, TREE, MY_SESSIONS, 'c', true)).toBeNull();
        expect(resolveSessionListDrop(ROWS, TREE, ACME, 'a', true)).toBeNull();
    });
});
