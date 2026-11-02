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
        expect(await backend.listSessions(STORAGE_MANIFEST_FILE)).toEqual([{ path: TEST_SESSION_ID, storageType: 'opfs' }]);
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
    it('reorders the sessions of the manifest and keeps unlisted ones at the end', async () => {
        const ids = ['a', 'b', 'c'].map(c => `${c.repeat(8)}-0000-4000-8000-000000000000`);
        for (const id of ids) await backend.saveSessionManifest(id, testSession({ sessionId: id }));
        await backend.reorderSessions([ids[2], 'unknown', ids[0], ids[2]]);
        expect((await backend.listSessions(STORAGE_MANIFEST_FILE)).map(entry => entry.path)).toEqual([ids[2], ids[0], ids[1]]);
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

    it('clears the app folders and the sessions of the manifest but no other storage', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01.sql', 'SELECT 1');
        await backend.createConnectionFolder('connection');
        files.set('other/file.txt', 'kept');
        await backend.clearAllStorage();
        expect(await backend.listSessions(STORAGE_MANIFEST_FILE)).toEqual([]);
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
        files.set(STORAGE_MANIFEST_FILE, JSON.stringify({ sessions: [] }));
        await backend.saveAppSettings({ keywordCase: 'upper' });
        expect(JSON.parse(files.get(STORAGE_MANIFEST_FILE)! as string).storageVersion).toBe(STORAGE_VERSION);
    });
});
