import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as core from '../../core/index.js';

import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { STORAGE_MANIFEST_FILE } from './storage_backend.js';
import { TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';
import { OPFSDirectoryMock } from '../testing/opfs_mock.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The core that the backend asks about the names of attachments and the changes of the workbook tree
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('OPFSStorageBackend V2 flat storage', () => {
    let backend: OPFSStorageBackend;
    let files: Map<string, string | ArrayBuffer>;
    let dirs: Set<string>;

    beforeEach(async () => {
        files = new Map();
        dirs = new Set();
        backend = new OPFSStorageBackend(dql, async () => new OPFSDirectoryMock('', files, dirs) as unknown as FileSystemDirectoryHandle);
        await backend.initialize();
    });

    it('round-trips flat scripts without an index', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '10_last.sql', 'SELECT 10');
        await backend.saveScript(TEST_WORKBOOK_ID, '2_first.sql', 'SELECT 2');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([
            { name: '2_first.sql', sql: 'SELECT 2' },
            { name: '10_last.sql', sql: 'SELECT 10' },
        ]);
        expect(files.has(`workbooks/${TEST_WORKBOOK_ID}/dashql-session-index.json`)).toBe(false);
        expect(await backend.listWorkbooks()).toEqual([{ path: TEST_WORKBOOK_ID, storageType: 'opfs' }]);
    });

    it('loads the manifest of a workbook', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        expect(await backend.loadWorkbook(TEST_WORKBOOK_ID)).toEqual(testWorkbook());
    });

    it('rejects a workbook manifest without a workbook id', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        files.set(`workbooks/${TEST_WORKBOOK_ID}/dashql-workbook.json`, JSON.stringify({ ...testWorkbook(), workbookId: '' }));
        await expect(backend.loadWorkbook(TEST_WORKBOOK_ID)).rejects.toThrow(`Workbook ${TEST_WORKBOOK_ID} is missing required workbookId field`);
    });

    it('rejects nested and draft entries instead of importing V1 data', async () => {
        dirs.add('workbooks');
        dirs.add(`workbooks/${TEST_WORKBOOK_ID}`);
        dirs.add(`workbooks/${TEST_WORKBOOK_ID}/scripts`);
        dirs.add(`workbooks/${TEST_WORKBOOK_ID}/scripts/page`);
        await expect(backend.loadScripts(TEST_WORKBOOK_ID)).rejects.toThrow('nested scripts directory');
        dirs.delete(`workbooks/${TEST_WORKBOOK_ID}/scripts/page`);
        files.set(`workbooks/${TEST_WORKBOOK_ID}/scripts/dashql-draft.sql`, 'SELECT 1');
        await expect(backend.loadScripts(TEST_WORKBOOK_ID)).rejects.toThrow('dashql-draft.sql is not supported');
    });
    it('deletes the files of a workbook and keeps its results on request', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.saveDataFile(TEST_WORKBOOK_ID, 'a.parquet', new Uint8Array([1, 2, 3]));
        const result = `workbooks/${TEST_WORKBOOK_ID}/results/01_query.${'0'.repeat(64)}.${'0'.repeat(20)}.parquet`;
        dirs.add(`workbooks/${TEST_WORKBOOK_ID}/results`);
        files.set(result, 'parquet');

        await backend.deleteWorkbookFiles(TEST_WORKBOOK_ID, { keepResults: true });
        expect([...files.keys()].filter(path => path.startsWith(`workbooks/${TEST_WORKBOOK_ID}/`))).toEqual([result]);
        expect([...dirs].filter(path => path.startsWith(`workbooks/${TEST_WORKBOOK_ID}/`))).toEqual([`workbooks/${TEST_WORKBOOK_ID}/results`]);
        // The registry entry stays
        expect(await backend.listWorkbooks()).toEqual([{ path: TEST_WORKBOOK_ID, storageType: 'opfs' }]);
        // A workbook without files is no error
        await backend.deleteWorkbookFiles('99999999-0000-4000-8000-000000000000', { keepResults: true });

        await backend.deleteWorkbookFiles(TEST_WORKBOOK_ID);
        expect([...files.keys()].filter(path => path.startsWith(`workbooks/${TEST_WORKBOOK_ID}/`))).toEqual([]);
    });

    it('starts a new storage with the folder My Workbooks and keeps it deleted once', async () => {
        expect(JSON.parse(files.get('workbooktree/My Workbooks/dashql-folder.json') as string)).toEqual({ workbooks: [] });
        expect((await backend.loadWorkbookTree()).folders.map(folder => folder.name)).toEqual(['My Workbooks']);
        await backend.deleteFolder(['My Workbooks']);
        await backend.initialize();
        expect((await backend.loadWorkbookTree()).folders).toEqual([]);
    });

    it('registers new workbooks at the end of the root', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        expect(JSON.parse(files.get('workbooktree/dashql-folder.json') as string)).toEqual({
            workbooks: [{ path: TEST_WORKBOOK_ID, storageType: 'opfs' }],
        });
        expect(JSON.parse(files.get('workbooktree/My Workbooks/dashql-folder.json') as string)).toEqual({ workbooks: [] });
        expect(files.has(STORAGE_MANIFEST_FILE)).toBe(false);
    });

    it('moves the workbooks within and across the folders of the workbook tree', async () => {
        const ids = ['a', 'b', 'c'].map(c => `${c.repeat(8)}-0000-4000-8000-000000000000`);
        for (const id of ids) await backend.saveWorkbookManifest(id, testWorkbook({ workbookId: id }));
        await backend.moveWorkbook(ids[2], [], 0);
        expect((await backend.listWorkbooks()).map(entry => entry.path)).toEqual([ids[2], ids[0], ids[1]]);

        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveWorkbook(ids[0], ['clients', 'acme'], 0);
        await backend.moveWorkbook(ids[1], ['clients'], 5);
        await backend.moveWorkbook(ids[2], [], 0);
        const tree = await backend.loadWorkbookTree();
        expect(tree.workbooks.map(entry => entry.path)).toEqual([ids[2]]);
        expect(tree.folders.map(folder => folder.name)).toEqual(['clients', 'My Workbooks']);
        expect(tree.folders[0].workbooks.map(entry => entry.path)).toEqual([ids[1]]);
        expect(tree.folders[0].folders[0]).toMatchObject({ name: 'acme', path: ['clients', 'acme'] });
        expect(tree.folders[0].folders[0].workbooks.map(entry => entry.path)).toEqual([ids[0]]);
        expect(tree.folders[1].workbooks).toEqual([]);
        // The subfolders of a folder come before its workbooks
        expect((await backend.listWorkbooks()).map(entry => entry.path)).toEqual([ids[0], ids[1], ids[2]]);

        // A workbook that is written again keeps its folder
        await backend.saveWorkbookManifest(ids[0], testWorkbook({ workbookId: ids[0] }));
        expect((await backend.loadWorkbookTree()).folders[0].folders[0].workbooks.map(entry => entry.path)).toEqual([ids[0]]);
        await expect(backend.moveWorkbook(ids[0], ['missing'], 0)).rejects.toThrow('There is no folder');
    });

    it('places a new workbook in a folder before its first write', async () => {
        await backend.createFolder(['drafts']);
        await backend.moveWorkbook(TEST_WORKBOOK_ID, ['drafts'], 0);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const tree = await backend.loadWorkbookTree();
        expect(tree.folders.map(folder => [folder.name, folder.workbooks])).toEqual([
            ['drafts', [{ path: TEST_WORKBOOK_ID, storageType: 'opfs' }]],
            ['My Workbooks', []],
        ]);
    });

    it('sorts the folders by their names and validates new names', async () => {
        for (const name of ['q10', 'q2', 'Archive']) await backend.createFolder([name]);
        expect((await backend.loadWorkbookTree()).folders.map(folder => folder.name)).toEqual(['Archive', 'My Workbooks', 'q2', 'q10']);
        await expect(backend.createFolder(['archive'])).rejects.toThrow('There is already a folder');
        await expect(backend.createFolder(['a/b'])).rejects.toThrow('not a valid folder name');
        await expect(backend.createFolder(['missing', 'child'])).rejects.toThrow('There is no folder');
    });

    it('renames and moves folders with their workbooks', async () => {
        await backend.deleteFolder(['My Workbooks']);
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.createFolder(['archive']);
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.moveWorkbook(TEST_WORKBOOK_ID, ['clients', 'acme'], 0);

        await backend.moveFolder(['clients', 'acme'], ['clients'], 'Acme');
        let tree = await backend.loadWorkbookTree();
        expect(tree.folders[1].folders.map(folder => folder.name)).toEqual(['Acme']);
        expect(tree.folders[1].folders[0].workbooks.map(entry => entry.path)).toEqual([TEST_WORKBOOK_ID]);

        await backend.moveFolder(['clients'], ['archive']);
        tree = await backend.loadWorkbookTree();
        expect(tree.folders.map(folder => folder.name)).toEqual(['archive']);
        expect(tree.folders[0].folders[0].folders[0]).toMatchObject({ path: ['archive', 'clients', 'Acme'] });
        expect(await backend.listWorkbooks()).toEqual([{ path: TEST_WORKBOOK_ID, storageType: 'opfs' }]);

        await expect(backend.moveFolder(['archive'], ['archive', 'clients'])).rejects.toThrow('cannot move into itself');
        await backend.createFolder(['clients']);
        await expect(backend.moveFolder(['archive', 'clients'], [])).rejects.toThrow('There is already a folder');
    });

    it('moves the workbooks of a deleted folder to its parent', async () => {
        const ids = ['a', 'b', 'c'].map(c => `${c.repeat(8)}-0000-4000-8000-000000000000`);
        for (const id of ids) await backend.saveWorkbookManifest(id, testWorkbook({ workbookId: id }));
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveWorkbook(ids[0], ['clients'], 0);
        await backend.moveWorkbook(ids[1], ['clients', 'acme'], 0);
        await backend.deleteFolder(['clients']);
        const tree = await backend.loadWorkbookTree();
        expect(tree.folders.map(folder => [folder.name, folder.workbooks])).toEqual([['My Workbooks', []]]);
        expect(tree.workbooks.map(entry => entry.path)).toEqual([ids[2], ids[1], ids[0]]);
        expect([...dirs].filter(dir => dir.startsWith('workbooktree/clients'))).toEqual([]);
    });

    it('lists a workbook that the tree registers twice where it comes first', async () => {
        dirs.add('workbooktree');
        dirs.add('workbooktree/clients');
        files.set('workbooktree/dashql-folder.json', JSON.stringify({ workbooks: [{ path: TEST_WORKBOOK_ID }] }));
        files.set('workbooktree/clients/dashql-folder.json', JSON.stringify({ workbooks: [{ path: TEST_WORKBOOK_ID }] }));
        expect(await backend.listWorkbooks()).toEqual([{ path: TEST_WORKBOOK_ID }]);
        expect((await backend.loadWorkbookTree()).folders[0].workbooks).toEqual([{ path: TEST_WORKBOOK_ID }]);
        // The next change of the tree drops the duplicate
        await backend.removeWorkbookEntry('ffffffff-0000-4000-8000-000000000000');
        expect(JSON.parse(files.get('workbooktree/dashql-folder.json') as string)).toEqual({ workbooks: [] });
    });

    it('renames scripts and skips scripts that are not written yet', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_old.sql', 'SELECT 1');
        await backend.renameScript(TEST_WORKBOOK_ID, '01_old.sql', '01_old.sql');
        await backend.renameScript(TEST_WORKBOOK_ID, '01_old.sql', '02_new.sql');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '02_new.sql', sql: 'SELECT 1' }]);
        await expect(backend.renameScript(TEST_WORKBOOK_ID, 'missing.sql', 'other.sql')).resolves.toBeUndefined();
        await expect(backend.renameScript('ffffffff-0000-4000-8000-000000000000', 'a.sql', 'b.sql')).resolves.toBeUndefined();
    });

    it('deletes a script that is gone without a failure, the writer retries deletions', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.deleteScript(TEST_WORKBOOK_ID, '01_query.sql');
        await expect(backend.deleteScript(TEST_WORKBOOK_ID, '01_query.sql')).resolves.toBeUndefined();
        await expect(backend.deleteScript('ffffffff-0000-4000-8000-000000000000', 'a.sql')).resolves.toBeUndefined();
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('clears the app folders, the clouds and the workbook tree but no other storage', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01.sql', 'SELECT 1');
        await backend.createConnectionFolder('connection');
        files.set('other/file.txt', 'kept');
        // The database of a local cloud
        dirs.add('clouds');
        files.set('clouds/local.hyper', 'db');
        await backend.clearAllStorage();
        expect(await backend.listWorkbooks()).toEqual([]);
        expect([...files.keys()].filter(path => path.startsWith('workbooktree/'))).toEqual([]);
        expect([...files.keys()].filter(path => path.startsWith('workbooks/') || path.startsWith('connections/'))).toEqual([]);
        expect(dirs.has('connections/connection')).toBe(false);
        expect(files.has('clouds/local.hyper')).toBe(false);
        expect(files.get('other/file.txt')).toBe('kept');
    });

    it('preserves binary data through rename fallback and deletion', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40]);
        await backend.saveDataFile(TEST_WORKBOOK_ID, 'payload.parquet', bytes);
        expect((await backend.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'payload.parquet', sizeBytes: 5 }]);
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, 'payload.parquet')).toEqual(bytes);
        await backend.renameDataFile(TEST_WORKBOOK_ID, 'payload.parquet', 'renamed.parquet');
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, 'renamed.parquet')).toEqual(bytes);
        await backend.deleteDataFile(TEST_WORKBOOK_ID, 'renamed.parquet');
        expect(await backend.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
        await expect(backend.saveDataFile(TEST_WORKBOOK_ID, 'bad\\name', bytes)).rejects.toThrow('basename');
    });
    it('deletes the folder of a connection with its files', async () => {
        await backend.saveConnectionFile('connection', 'dashql-catalog-relations.sql', 'CREATE TABLE t (x int);');
        expect(dirs.has('connections/connection')).toBe(true);
        await backend.deleteConnectionFiles('connection');
        expect(dirs.has('connections/connection')).toBe(false);
        expect(await backend.loadConnectionFile('connection', 'dashql-catalog-relations.sql')).toBeNull();
        await backend.deleteConnectionFiles('connection');
    });
    it('round-trips the SQL keyword case preference in the app manifest', async () => {
        await backend.saveAppSettings({ keywordCase: 'upper' });
        expect(await backend.loadAppSettings()).toEqual({ keywordCase: 'upper' });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).appSettings.keywordCase).toBe('upper');
    });

    it('round-trips the narrow screen layout override in the app manifest', async () => {
        await backend.saveAppSettings({ narrowScreenLayout: true });
        expect(await backend.loadAppSettings()).toEqual({ narrowScreenLayout: true });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).appSettings.narrowScreenLayout).toBe(true);
        await backend.saveAppSettings({ narrowScreenLayout: false });
        expect(await backend.loadAppSettings()).toEqual({ narrowScreenLayout: false });
    });

    it('keeps the storage version of the manifest, the migration stamps it', async () => {
        files.set(STORAGE_MANIFEST_FILE, JSON.stringify({ storageVersion: 7 }));
        await backend.saveAppSettings({ keywordCase: 'upper' });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).storageVersion).toBe(7);
    });
});
