import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { createRuntime } from '../runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../store/store.js';
import { TestLogger } from '@ankoh/dashql-platform/testing/test_logger';
import { testCore } from '../testing/test_runtime.js';
import { openNodeRoot } from '@ankoh/dashql-platform/node/node_directory_handle';
import { NODE_FILE_SYSTEM } from '@ankoh/dashql-platform/node/node_file_system';
import { NativeStorageBackend } from '@ankoh/dashql-platform/storage/native_storage_backend';
import { createStorageRoot } from '@ankoh/dashql-platform/storage/storage_root';
import { STORAGE_VERSION, WORKBOOK_FORMAT_VERSION } from '@ankoh/dashql-platform/storage/migration/versions';

const SESSION_A = '11111111-0000-4000-8000-00000000000a';
const SESSION_B = '11111111-0000-4000-8000-00000000000b';
const DB_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const WASM = { hyper: { protocol: 'WASM' } };

/// The metadata of a notebook of format version 2
function notebook(notebookId: string, databaseId: string): string {
    return JSON.stringify({ formatVersion: 2, notebookId, mainDatabase: { databaseId, params: WASM }, attachedDatabases: [], metadata: {} });
}

// The steps of the migrations are tested in the core (`storage_migration_test.rs`), these tests run them on the runtime
// over a storage root of the platform and over the folder of a workbook
describe('the migrations of the runtime', () => {
    let dir: string;
    beforeEach(async () => { dir = await fs.mkdtemp(path.join(process.env.TEST_TMPDIR ?? os.tmpdir(), 'storage-root-')); });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    const read = async (file: string) => await fs.readFile(path.join(dir, file), 'utf8');
    const exists = async (file: string) => await fs.access(path.join(dir, file)).then(() => true, () => false);
    const write = async (file: string, text: string) => {
        await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
        await fs.writeFile(path.join(dir, file), text);
    };

    /// Migrate the storage root in the folder of the test, a native folder is a folder of its own
    async function migrate(native: string | null = null) {
        const root = createStorageRoot(await openNodeRoot(path.join(dir, 'root')), async nativePath =>
            nativePath === native ? new NativeStorageBackend(nativePath, NODE_FILE_SYSTEM) : null);
        const runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: await testCore(), storageRoot: root });
        try {
            return await runtime.migrateStorage();
        } finally {
            await runtime.destroy();
        }
    }

    it('leaves a fresh storage untouched and migrates to the versions of the app', async () => {
        expect(await migrate()).toEqual({ steps: 0, workbooks: 0, storageVersion: STORAGE_VERSION, formatVersion: WORKBOOK_FORMAT_VERSION });
        expect(await fs.readdir(path.join(dir, 'root'))).toEqual([]);
    });

    it('brings a storage of notebooks and a native folder to the current versions', async () => {
        const native = path.join(dir, 'native');
        await write('root/dashql-manifest.json', JSON.stringify({
            notebooks: [{ path: SESSION_A }, { path: SESSION_B, storageType: 'native', nativePath: native }],
            appSettings: { keywordCase: 'upper' },
        }));
        await write(`root/notebooks/${SESSION_A}/dashql-notebook.json`, notebook(SESSION_A, DB_A));
        await write(`root/notebooks/${SESSION_A}/dashql-relations.sql`, 'CREATE TABLE a(id int);');
        await write(`root/notebooks/${SESSION_A}/scripts/1_a.sql`, 'SELECT 1');
        await write('native/dashql-notebook.json', notebook(SESSION_B, DB_A));

        expect(await migrate(native)).toMatchObject({ steps: STORAGE_VERSION - 1, workbooks: 2 });
        const manifest = JSON.parse(await read('root/dashql-manifest.json'));
        expect(manifest).toMatchObject({ storageVersion: STORAGE_VERSION, appSettings: { keywordCase: 'upper' } });
        expect(manifest.connections.map((entry: { id: string }) => entry.id)).toEqual([DB_A]);
        expect(await read(`root/connections/${DB_A}/dashql-catalog-relations.sql`)).toBe('CREATE TABLE a(id int);');
        expect(await exists('root/notebooks')).toBe(false);
        expect(JSON.parse(await read(`root/workbooks/${SESSION_A}/dashql-workbook.json`))).toMatchObject({ formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_A });
        expect(await read(`root/workbooks/${SESSION_A}/scripts/1_a.sql`)).toBe('SELECT 1');
        expect(JSON.parse(await read('root/workbooktree/My Sessions/dashql-folder.json')).workbooks.map((entry: { path: string }) => entry.path)).toEqual([SESSION_A, SESSION_B]);
        // The native folder references the consolidated connection
        expect(await exists('native/dashql-notebook.json')).toBe(false);
        expect(JSON.parse(await read('native/dashql-workbook.json'))).toMatchObject({ formatVersion: WORKBOOK_FORMAT_VERSION, workbookId: SESSION_B });

        // A migrated storage stays as it is
        expect(await migrate(native)).toMatchObject({ steps: 0, workbooks: 0 });
    });

    it('refuses a storage of a newer version', async () => {
        const manifest = JSON.stringify({ storageVersion: STORAGE_VERSION + 1 });
        await write('root/dashql-manifest.json', manifest);
        await expect(migrate()).rejects.toThrow('newer version of DashQL');
        expect(await read('root/dashql-manifest.json')).toBe(manifest);
    });

    it('brings the folder of a workbook to the current format before it is restored', async () => {
        await write('folder/dashql-session.json', JSON.stringify({
            formatVersion: 10, sessionId: SESSION_A, connections: [{ connectionId: DB_A, params: WASM }],
            scripts: [{ name: 'a.sql', connectionId: DB_A }], attachments: [], metadata: {},
        }));
        await write('folder/scripts/a.sql', 'select 1');
        const storage = new NativeStorageBackend(path.join(dir, 'folder'), NODE_FILE_SYSTEM);
        const runtime = createRuntime({ logger: new TestLogger(), scheduler: TASK_UPDATE_SCHEDULER, setupCore: await testCore(), storage });
        try {
            // The folder is its own storage, the id is only known after the migration
            expect(await runtime.migrateWorkbookFolder('')).toBe('migrated');
            expect(await runtime.migrateWorkbookFolder('')).toBe('current');
            const { workbookId } = await storage.loadWorkbook('');
            expect(workbookId).toBe(SESSION_A);
            await runtime.restoreWorkbook(workbookId);
            expect(runtime.store.get('workbook', workbookId)?.scriptOrder).toEqual(['a.sql']);
        } finally {
            await runtime.destroy();
        }
        expect(await exists('folder/dashql-session.json')).toBe(false);
    });
});
