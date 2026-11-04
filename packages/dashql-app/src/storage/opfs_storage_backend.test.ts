import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { STORAGE_MANIFEST_FILE } from './storage_backend.js';
import { STORAGE_VERSION } from './migration/versions.js';
import { TEST_SESSION_ID, testSession } from './session_test_backend.js';
import { OPFSDirectoryMock } from '../tests/opfs_mock.js';

describe('OPFSStorageBackend V2 flat storage', () => {
    let backend: OPFSStorageBackend;
    let files: Map<string, string | ArrayBuffer>;
    let dirs: Set<string>;

    beforeEach(async () => {
        files = new Map();
        dirs = new Set();
        backend = new OPFSStorageBackend(async () => new OPFSDirectoryMock('', files, dirs) as unknown as FileSystemDirectoryHandle);
        await backend.initialize();
    });

    it('round-trips flat scripts without an index', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '10_last.sql', 'SELECT 10');
        await backend.saveScript(TEST_SESSION_ID, '2_first.sql', 'SELECT 2');
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([
            { name: '2_first.sql', sql: 'SELECT 2' },
            { name: '10_last.sql', sql: 'SELECT 10' },
        ]);
        expect(files.has(`sessions/${TEST_SESSION_ID}/dashql-session-index.json`)).toBe(false);
        expect(await backend.listSessions()).toEqual([{ path: TEST_SESSION_ID, storageType: 'opfs' }]);
    });

    it('loads the manifest of a session', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        expect(await backend.loadSession(TEST_SESSION_ID)).toEqual(testSession());
    });

    it('rejects a session manifest without a session id', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        files.set(`sessions/${TEST_SESSION_ID}/dashql-session.json`, JSON.stringify({ ...testSession(), sessionId: '' }));
        await expect(backend.loadSession(TEST_SESSION_ID)).rejects.toThrow(`Session ${TEST_SESSION_ID} is missing required sessionId field`);
    });

    it('rejects nested and draft entries instead of importing V1 data', async () => {
        dirs.add('sessions');
        dirs.add(`sessions/${TEST_SESSION_ID}`);
        dirs.add(`sessions/${TEST_SESSION_ID}/scripts`);
        dirs.add(`sessions/${TEST_SESSION_ID}/scripts/page`);
        await expect(backend.loadScripts(TEST_SESSION_ID)).rejects.toThrow('nested scripts directory');
        dirs.delete(`sessions/${TEST_SESSION_ID}/scripts/page`);
        files.set(`sessions/${TEST_SESSION_ID}/scripts/dashql-draft.sql`, 'SELECT 1');
        await expect(backend.loadScripts(TEST_SESSION_ID)).rejects.toThrow('dashql-draft.sql is not supported');
    });
    it('starts a new storage with the folder My Sessions and keeps it deleted once', async () => {
        expect(JSON.parse(files.get('sessiontree/My Sessions/dashql-folder.json') as string)).toEqual({ sessions: [] });
        expect((await backend.loadSessionTree()).folders.map(folder => folder.name)).toEqual(['My Sessions']);
        await backend.deleteFolder(['My Sessions']);
        await backend.initialize();
        expect((await backend.loadSessionTree()).folders).toEqual([]);
    });

    it('registers new sessions at the end of the root', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        expect(JSON.parse(files.get('sessiontree/dashql-folder.json') as string)).toEqual({
            sessions: [{ path: TEST_SESSION_ID, storageType: 'opfs' }],
        });
        expect(JSON.parse(files.get('sessiontree/My Sessions/dashql-folder.json') as string)).toEqual({ sessions: [] });
        expect(files.has(STORAGE_MANIFEST_FILE)).toBe(false);
    });

    it('moves the sessions within and across the folders of the session tree', async () => {
        const ids = ['a', 'b', 'c'].map(c => `${c.repeat(8)}-0000-4000-8000-000000000000`);
        for (const id of ids) await backend.saveSessionManifest(id, testSession({ sessionId: id }));
        await backend.moveSession(ids[2], [], 0);
        expect((await backend.listSessions()).map(entry => entry.path)).toEqual([ids[2], ids[0], ids[1]]);

        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveSession(ids[0], ['clients', 'acme'], 0);
        await backend.moveSession(ids[1], ['clients'], 5);
        await backend.moveSession(ids[2], [], 0);
        const tree = await backend.loadSessionTree();
        expect(tree.sessions.map(entry => entry.path)).toEqual([ids[2]]);
        expect(tree.folders.map(folder => folder.name)).toEqual(['clients', 'My Sessions']);
        expect(tree.folders[0].sessions.map(entry => entry.path)).toEqual([ids[1]]);
        expect(tree.folders[0].folders[0]).toMatchObject({ name: 'acme', path: ['clients', 'acme'] });
        expect(tree.folders[0].folders[0].sessions.map(entry => entry.path)).toEqual([ids[0]]);
        expect(tree.folders[1].sessions).toEqual([]);
        // The subfolders of a folder come before its sessions
        expect((await backend.listSessions()).map(entry => entry.path)).toEqual([ids[0], ids[1], ids[2]]);

        // A session that is written again keeps its folder
        await backend.saveSessionManifest(ids[0], testSession({ sessionId: ids[0] }));
        expect((await backend.loadSessionTree()).folders[0].folders[0].sessions.map(entry => entry.path)).toEqual([ids[0]]);
        await expect(backend.moveSession(ids[0], ['missing'], 0)).rejects.toThrow('There is no folder');
    });

    it('places a new session in a folder before its first write', async () => {
        await backend.createFolder(['drafts']);
        await backend.moveSession(TEST_SESSION_ID, ['drafts'], 0);
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        const tree = await backend.loadSessionTree();
        expect(tree.folders.map(folder => [folder.name, folder.sessions])).toEqual([
            ['drafts', [{ path: TEST_SESSION_ID, storageType: 'opfs' }]],
            ['My Sessions', []],
        ]);
    });

    it('sorts the folders by their names and validates new names', async () => {
        for (const name of ['q10', 'q2', 'Archive']) await backend.createFolder([name]);
        expect((await backend.loadSessionTree()).folders.map(folder => folder.name)).toEqual(['Archive', 'My Sessions', 'q2', 'q10']);
        await expect(backend.createFolder(['archive'])).rejects.toThrow('There is already a folder');
        await expect(backend.createFolder(['a/b'])).rejects.toThrow('not a valid folder name');
        await expect(backend.createFolder(['missing', 'child'])).rejects.toThrow('There is no folder');
    });

    it('renames and moves folders with their sessions', async () => {
        await backend.deleteFolder(['My Sessions']);
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.createFolder(['archive']);
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.moveSession(TEST_SESSION_ID, ['clients', 'acme'], 0);

        await backend.moveFolder(['clients', 'acme'], ['clients'], 'Acme');
        let tree = await backend.loadSessionTree();
        expect(tree.folders[1].folders.map(folder => folder.name)).toEqual(['Acme']);
        expect(tree.folders[1].folders[0].sessions.map(entry => entry.path)).toEqual([TEST_SESSION_ID]);

        await backend.moveFolder(['clients'], ['archive']);
        tree = await backend.loadSessionTree();
        expect(tree.folders.map(folder => folder.name)).toEqual(['archive']);
        expect(tree.folders[0].folders[0].folders[0]).toMatchObject({ path: ['archive', 'clients', 'Acme'] });
        expect(await backend.listSessions()).toEqual([{ path: TEST_SESSION_ID, storageType: 'opfs' }]);

        await expect(backend.moveFolder(['archive'], ['archive', 'clients'])).rejects.toThrow('cannot move into itself');
        await backend.createFolder(['clients']);
        await expect(backend.moveFolder(['archive', 'clients'], [])).rejects.toThrow('There is already a folder');
    });

    it('moves the sessions of a deleted folder to its parent', async () => {
        const ids = ['a', 'b', 'c'].map(c => `${c.repeat(8)}-0000-4000-8000-000000000000`);
        for (const id of ids) await backend.saveSessionManifest(id, testSession({ sessionId: id }));
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveSession(ids[0], ['clients'], 0);
        await backend.moveSession(ids[1], ['clients', 'acme'], 0);
        await backend.deleteFolder(['clients']);
        const tree = await backend.loadSessionTree();
        expect(tree.folders.map(folder => [folder.name, folder.sessions])).toEqual([['My Sessions', []]]);
        expect(tree.sessions.map(entry => entry.path)).toEqual([ids[2], ids[1], ids[0]]);
        expect([...dirs].filter(dir => dir.startsWith('sessiontree/clients'))).toEqual([]);
    });

    it('lists a session that the tree registers twice where it comes first', async () => {
        dirs.add('sessiontree');
        dirs.add('sessiontree/clients');
        files.set('sessiontree/dashql-folder.json', JSON.stringify({ sessions: [{ path: TEST_SESSION_ID }] }));
        files.set('sessiontree/clients/dashql-folder.json', JSON.stringify({ sessions: [{ path: TEST_SESSION_ID }] }));
        expect(await backend.listSessions()).toEqual([{ path: TEST_SESSION_ID }]);
        expect((await backend.loadSessionTree()).folders[0].sessions).toEqual([{ path: TEST_SESSION_ID }]);
        // The next change of the tree drops the duplicate
        await backend.removeSessionEntry('ffffffff-0000-4000-8000-000000000000');
        expect(JSON.parse(files.get('sessiontree/dashql-folder.json') as string)).toEqual({ sessions: [] });
    });

    it('renames scripts and skips scripts that are not written yet', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01_old.sql', 'SELECT 1');
        await backend.renameScript(TEST_SESSION_ID, '01_old.sql', '01_old.sql');
        await backend.renameScript(TEST_SESSION_ID, '01_old.sql', '02_new.sql');
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '02_new.sql', sql: 'SELECT 1' }]);
        await expect(backend.renameScript(TEST_SESSION_ID, 'missing.sql', 'other.sql')).resolves.toBeUndefined();
        await expect(backend.renameScript('ffffffff-0000-4000-8000-000000000000', 'a.sql', 'b.sql')).resolves.toBeUndefined();
    });

    it('clears the app folders and the session tree but no other storage', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01.sql', 'SELECT 1');
        await backend.createConnectionFolder('connection');
        files.set('other/file.txt', 'kept');
        await backend.clearAllStorage();
        expect(await backend.listSessions()).toEqual([]);
        expect([...files.keys()].filter(path => path.startsWith('sessiontree/'))).toEqual([]);
        expect([...files.keys()].filter(path => path.startsWith('sessions/') || path.startsWith('connections/'))).toEqual([]);
        expect(dirs.has('connections/connection')).toBe(false);
        expect(files.get('other/file.txt')).toBe('kept');
    });

    it('preserves binary data through rename fallback and deletion', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40]);
        await backend.saveDataFile(TEST_SESSION_ID, 'payload.parquet', bytes);
        expect((await backend.listDataFiles(TEST_SESSION_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'payload.parquet', sizeBytes: 5 }]);
        expect(await backend.loadDataFile(TEST_SESSION_ID, 'payload.parquet')).toEqual(bytes);
        await backend.renameDataFile(TEST_SESSION_ID, 'payload.parquet', 'renamed.parquet');
        expect(await backend.loadDataFile(TEST_SESSION_ID, 'renamed.parquet')).toEqual(bytes);
        await backend.deleteDataFile(TEST_SESSION_ID, 'renamed.parquet');
        expect(await backend.listDataFiles(TEST_SESSION_ID)).toEqual([]);
        await expect(backend.saveDataFile(TEST_SESSION_ID, 'bad\\name', bytes)).rejects.toThrow('basename');
    });
    it('creates the folder of a connection and deletes it once its files are released', async () => {
        await backend.createConnectionFolder('connection');
        expect(dirs.has('connections/connection')).toBe(true);
        await backend.saveConnectionFile('connection', 'dashql-catalog-relations.sql', 'CREATE TABLE t (x int);');
        // The monitoring database is still open for a moment after the connection was deleted
        const removeEntry = OPFSDirectoryMock.prototype.removeEntry;
        let attempts = 0;
        const spy = vi.spyOn(OPFSDirectoryMock.prototype, 'removeEntry').mockImplementation(async function (this: OPFSDirectoryMock, ...args) {
            if (++attempts < 3) throw new DOMException('in use', 'NoModificationAllowedError');
            return await removeEntry.apply(this, args);
        });
        try {
            await backend.deleteConnectionFiles('connection');
        } finally {
            spy.mockRestore();
        }
        expect(attempts).toBe(3);
        expect(dirs.has('connections/connection')).toBe(false);
        expect(await backend.loadConnectionFile('connection', 'dashql-catalog-relations.sql')).toBeNull();
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

    it('round-trips the sessions with agent access in the app manifest', async () => {
        const agentSessions = ['session-a', 'session-b'];
        await backend.saveAppSettings({ agentSessions });
        expect(await backend.loadAppSettings()).toEqual({ agentSessions });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).appSettings.agentSessions).toEqual(agentSessions);
    });

    it('stamps the current storage version on every manifest write', async () => {
        files.set(STORAGE_MANIFEST_FILE, JSON.stringify({}));
        await backend.saveAppSettings({ keywordCase: 'upper' });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).storageVersion).toBe(STORAGE_VERSION);
    });
});
