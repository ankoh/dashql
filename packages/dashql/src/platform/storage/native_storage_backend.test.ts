import { beforeEach, describe, expect, it } from 'vitest';

import { fsStore, makeFsMock, resetFsStore } from '../testing/test_fs_mock.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';
import { ExternalScriptChangeError, WorkbookFolderMissingError } from './storage_backend.js';

const DIR = '/tmp/v2-workbook';

describe('NativeStorageBackend V2 flat storage', () => {
    let backend: NativeStorageBackend;

    beforeEach(async () => {
        resetFsStore();
        backend = new NativeStorageBackend(DIR, makeFsMock());
        await backend.initialize();
    });

    it('round-trips manifest and naturally ordered flat scripts', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '10_last.sql', 'SELECT 10');
        await backend.saveScript(TEST_WORKBOOK_ID, '2_first.sql', 'SELECT 2');

        expect(await backend.loadWorkbook(TEST_WORKBOOK_ID)).toEqual(testWorkbook());
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([
            { name: '2_first.sql', sql: 'SELECT 2' },
            { name: '10_last.sql', sql: 'SELECT 10' },
        ]);
        // The order lives in the workbook file, the backend writes no index
        expect(fsStore.files.has(`${DIR}/dashql-session-index.json`)).toBe(false);
        expect(fsStore.files.has(`${DIR}/scripts/2_first.sql`)).toBe(true);
        expect([...fsStore.files.keys()].some(path => path.includes('/scripts/page/'))).toBe(false);
    });

    it('writes a .gitignore with the workbook file', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        expect(fsStore.files.get(`${DIR}/.gitignore`)).toBe('cache/\n*.hyper\n');
    });

    it('appends missing entries to an existing .gitignore', async () => {
        fsStore.files.set(`${DIR}/.gitignore`, 'notes.txt\ncache/');
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        expect(fsStore.files.get(`${DIR}/.gitignore`)).toBe('notes.txt\ncache/\n*.hyper\n');
    });

    it('persists rename and delete', async () => {
        await backend.saveScript(TEST_WORKBOOK_ID, '01_old.sql', 'SELECT 1');
        await backend.renameScript(TEST_WORKBOOK_ID, '01_old.sql', '01_new.sql');
        expect(await backend.loadScript(TEST_WORKBOOK_ID, '01_new.sql')).toEqual({ name: '01_new.sql', sql: 'SELECT 1' });
        await backend.deleteScript(TEST_WORKBOOK_ID, '01_new.sql');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it.each(['../x.sql', '', '.', '..', 'a\\b.sql', 'C:x.sql'])('refuses the script name %j that leaves the folder', async name => {
        await expect(backend.saveScript(TEST_WORKBOOK_ID, name, 'SELECT 1')).rejects.toThrow(/Invalid path/);
        await expect(backend.deleteScript(TEST_WORKBOOK_ID, name)).rejects.toThrow(/Invalid path/);
        expect([...fsStore.files.keys()].filter(path => !path.startsWith(`${DIR}/`))).toEqual([]);
    });

    it('refuses absolute and escaping paths of the folder', async () => {
        await expect(backend.readText('/etc/passwd')).rejects.toThrow(/Invalid path/);
        await expect(backend.readText('connections/../../x')).rejects.toThrow(/Invalid path/);
        await expect(backend.writeText('../dashql-workbook.json', '{}')).rejects.toThrow(/Invalid path/);
    });

    it.each([
        ['nested directory', () => fsStore.dirs.add(`${DIR}/scripts/page`)],
        ['draft file', () => fsStore.files.set(`${DIR}/scripts/dashql-draft.sql`, 'SELECT 1')],
        ['file of another kind', () => fsStore.files.set(`${DIR}/scripts/notes.txt`, 'notes')],
    ])('skips a %s among the scripts', async (_label, seed) => {
        await backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'SELECT 1');
        seed();
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: 'a.sql', sql: 'SELECT 1' }]);
    });

    it('leaves the user-owned directory intact on delete', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        const before = new Map(fsStore.files);
        await backend.deleteWorkbook(TEST_WORKBOOK_ID);
        expect(fsStore.files).toEqual(before);
    });
    it('preserves binary data through CRUD and lists naturally sorted names', async () => {
        const bytes = new Uint8Array([0, 255, 128, 195, 40]);
        await backend.saveDataFile(TEST_WORKBOOK_ID, '10_payload.parquet', bytes);
        await backend.saveDataFile(TEST_WORKBOOK_ID, '2_payload.parquet', new Uint8Array());
        expect((await backend.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([
            { name: '2_payload.parquet', sizeBytes: 0 }, { name: '10_payload.parquet', sizeBytes: 5 },
        ]);
        await backend.renameDataFile(TEST_WORKBOOK_ID, '10_payload.parquet', '1_renamed.parquet');
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, '1_renamed.parquet')).toEqual(bytes);
        await backend.deleteDataFile(TEST_WORKBOOK_ID, '1_renamed.parquet');
        expect(await backend.listDataFiles(TEST_WORKBOOK_ID)).toHaveLength(1);
        await expect(backend.saveDataFile(TEST_WORKBOOK_ID, '../escape', bytes)).rejects.toThrow('basename');
        // A workbook attaches Parquet files only, the listing leaves other files of the folder out
        await expect(backend.saveDataFile(TEST_WORKBOOK_ID, 'notes.csv', bytes)).rejects.toThrow('Only Parquet files can be attached');
        fsStore.files.set(`${DIR}/attachments/notes.csv`, 'a,b');
        expect((await backend.listDataFiles(TEST_WORKBOOK_ID)).map(file => file.name)).toEqual(['2_payload.parquet']);
        fsStore.dirs.add(`${DIR}/attachments/nested`);
        await expect(backend.listDataFiles(TEST_WORKBOOK_ID)).rejects.toThrow('nested data');
    });

    it('reads, writes and removes the top-level files that the runtime migrates', async () => {
        // The runtime migrates a folder of an older version of the app before it loads the workbook
        // (node/storage_root.node.test.ts), it records the stamps of what it wrote
        expect(await backend.readText('dashql-session.json')).toBeNull();
        const stamp = await backend.writeText('dashql-session.json', '{"formatVersion":10}');
        expect(stamp).toEqual(await makeFsMock().fileStamp(`${DIR}/dashql-session.json`));
        expect(await backend.readText('dashql-session.json')).toBe('{"formatVersion":10}');
        await backend.remove('dashql-session.json');
        await backend.remove('dashql-session.json');
        expect(fsStore.files.has(`${DIR}/dashql-session.json`)).toBe(false);
    });
});

describe('NativeStorageBackend writes that expect a stamp', () => {
    let backend: NativeStorageBackend;
    const scriptPath = (name: string) => `${DIR}/scripts/${name}`;
    const editOutside = (name: string, sql: string) => {
        fsStore.files.set(scriptPath(name), sql);
        fsStore.mtimes.set(scriptPath(name), ++fsStore.clock);
    };
    const stampOf = async (name: string) => (await backend.stampFolder()).scripts.find(script => script.name === name);

    beforeEach(async () => {
        resetFsStore();
        backend = new NativeStorageBackend(DIR, makeFsMock());
        await backend.initialize();
        await backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 1');
        await backend.saveScript(TEST_WORKBOOK_ID, 'b.sql', 'select 2');
    });

    it('returns the stamp of what it wrote, the one of the listing', async () => {
        const written = await backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 10');
        expect(await stampOf('a.sql')).toEqual({ name: 'a.sql', ...written });
        const workbook = await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        expect((await backend.stampFolder()).workbook).toEqual(workbook);
    });

    it('refuses writes, deletes and renames whose file is not what they expect', async () => {
        const a = await stampOf('a.sql');
        const b = await stampOf('b.sql');
        editOutside('a.sql', 'select 10');
        editOutside('c.sql', 'select 3');
        await expect(backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 11', a)).rejects.toBeInstanceOf(ExternalScriptChangeError);
        await expect(backend.deleteScript(TEST_WORKBOOK_ID, 'a.sql', a)).rejects.toBeInstanceOf(ExternalScriptChangeError);
        await expect(backend.renameScript(TEST_WORKBOOK_ID, 'b.sql', 'c.sql', b, null)).rejects.toBeInstanceOf(ExternalScriptChangeError);
        await expect(backend.saveScript(TEST_WORKBOOK_ID, 'c.sql', 'select 4', null)).rejects.toBeInstanceOf(ExternalScriptChangeError);
        expect(fsStore.files.get(scriptPath('a.sql'))).toBe('select 10');
        expect(fsStore.files.get(scriptPath('b.sql'))).toBe('select 2');
        expect(fsStore.files.get(scriptPath('c.sql'))).toBe('select 3');
        // The stamp on disk lets the app version win, a write without an expectation is not checked
        await backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 11', await stampOf('a.sql'));
        expect(fsStore.files.get(scriptPath('a.sql'))).toBe('select 11');
        await backend.saveScript(TEST_WORKBOOK_ID, 'c.sql', 'select 5');
        expect(fsStore.files.get(scriptPath('c.sql'))).toBe('select 5');
    });

    it('refuses to overwrite a workbook file that changed outside the app', async () => {
        const mine = await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        // A git pull changes only the workbook file
        fsStore.files.set(`${DIR}/dashql-workbook.json`, JSON.stringify(testWorkbook({ name: 'pulled' })));
        fsStore.mtimes.set(`${DIR}/dashql-workbook.json`, ++fsStore.clock);
        const refused = backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'mine again' }), mine);
        await expect(refused).rejects.toMatchObject({ name: 'ExternalScriptChangeError', fileName: 'dashql-workbook.json' });
        expect(JSON.parse(fsStore.files.get(`${DIR}/dashql-workbook.json`)!).name).toBe('pulled');
    });

    it('deletes and renames a missing file without a failure', async () => {
        await backend.deleteScript(TEST_WORKBOOK_ID, 'missing.sql', null);
        await backend.renameScript(TEST_WORKBOOK_ID, 'missing.sql', 'other.sql', null, null);
        expect(fsStore.files.has(scriptPath('other.sql'))).toBe(false);
    });

    it('does not create a workbook folder that is gone when it writes a script', async () => {
        for (const path of [...fsStore.files.keys()].filter(path => path.startsWith(DIR))) fsStore.files.delete(path);
        for (const path of [...fsStore.dirs].filter(path => path.startsWith(DIR))) fsStore.dirs.delete(path);
        // The runtime stops retrying a write into a folder that is gone
        await expect(backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 1')).rejects.toBeInstanceOf(WorkbookFolderMissingError);
        expect([...fsStore.dirs].some(path => path.startsWith(DIR))).toBe(false);
    });
});
