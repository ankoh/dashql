import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../platform/electron_fs.js', async () => ({
    ...(await import('./test_fs_mock.js')).makeFsMock(),
    ...(await import('./test_fs_mock.js')).makePathMock(),
}));

import { fsStore, makeFsMock, resetFsStore } from './test_fs_mock.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { TEST_NOTEBOOK_ID, testNotebook } from './notebook_test_backend.js';

const DIR = '/tmp/v2-notebook';

describe('NativeStorageBackend V2 flat storage', () => {
    let backend: NativeStorageBackend;

    beforeEach(async () => {
        resetFsStore();
        globalThis.dashqlElectron = { fs: makeFsMock() } as unknown as DashQLElectronBridge;
        backend = new NativeStorageBackend(DIR);
        await backend.initialize();
    });

    it('round-trips manifest, catalog, and naturally ordered flat scripts', async () => {
        await backend.saveNotebookManifest(TEST_NOTEBOOK_ID, testNotebook());
        await backend.saveNotebookSchema(TEST_NOTEBOOK_ID, 'schema');
        await backend.saveNotebookFunctions(TEST_NOTEBOOK_ID, 'functions');
        await backend.saveScript(TEST_NOTEBOOK_ID, '10_last.sql', 'SELECT 10');
        await backend.saveScript(TEST_NOTEBOOK_ID, '2_first.sql', 'SELECT 2');

        expect(await backend.loadNotebook(TEST_NOTEBOOK_ID)).toEqual(testNotebook());
        expect(await backend.loadScripts(TEST_NOTEBOOK_ID)).toEqual([
            { name: '2_first.sql', sql: 'SELECT 2' },
            { name: '10_last.sql', sql: 'SELECT 10' },
        ]);
        expect(JSON.parse(fsStore.files.get(`${DIR}/dashql-notebook-index.json`)!)).toEqual({
            scripts: [{ name: '2_first.sql' }, { name: '10_last.sql' }],
        });
        expect(fsStore.files.has(`${DIR}/scripts/2_first.sql`)).toBe(true);
        expect([...fsStore.files.keys()].some(path => path.includes('/scripts/page/'))).toBe(false);
    });

    it('persists rename and delete while refreshing the flat index', async () => {
        await backend.saveScript(TEST_NOTEBOOK_ID, '01_old.sql', 'SELECT 1');
        await backend.renameScript(TEST_NOTEBOOK_ID, '01_old.sql', '01_new.sql');
        expect(await backend.loadScript(TEST_NOTEBOOK_ID, '01_new.sql')).toEqual({ name: '01_new.sql', sql: 'SELECT 1' });
        await backend.deleteScript(TEST_NOTEBOOK_ID, '01_new.sql');
        expect(await backend.loadScripts(TEST_NOTEBOOK_ID)).toEqual([]);
        expect(JSON.parse(fsStore.files.get(`${DIR}/dashql-notebook-index.json`)!)).toEqual({ scripts: [] });
    });

    it.each([
        ['nested directory', () => fsStore.dirs.add(`${DIR}/scripts/page`), 'nested scripts directory'],
        ['draft file', () => fsStore.files.set(`${DIR}/scripts/dashql-draft.sql`, 'SELECT 1'), 'dashql-draft.sql is not supported'],
    ])('rejects an obsolete %s', async (_label, seed, message) => {
        seed();
        await expect(backend.loadScripts(TEST_NOTEBOOK_ID)).rejects.toThrow(message);
    });

    it('leaves the user-owned directory intact on delete', async () => {
        await backend.saveNotebookManifest(TEST_NOTEBOOK_ID, testNotebook());
        await backend.saveScript(TEST_NOTEBOOK_ID, '01_query.sql', 'SELECT 1');
        const before = new Map(fsStore.files);
        await backend.deleteNotebook(TEST_NOTEBOOK_ID);
        expect(fsStore.files).toEqual(before);
    });
});
