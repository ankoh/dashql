import * as core from '../core/index.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from './runtime.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';

import { TestLogger } from '../platform/testing/test_logger.js';
import { CompositeStorageBackend } from '../platform/storage/composite_storage_backend.js';
import { NativeStorageBackend } from '../platform/storage/native_storage_backend.js';
import { OPFSStorageBackend } from '../platform/storage/opfs_storage_backend.js';
import { StorageBackendType } from '../platform/storage/storage_backend.js';
import { WorkbookTestRegistry, TEST_WORKBOOK_ID, testWorkbook } from '../platform/testing/workbook_test_backend.js';
import { fsStore, makeFsMock, resetFsStore } from '../platform/testing/test_fs_mock.js';
import { getOPFSRoot } from '../platform/opfs_root.js';
import { OPFSDirectoryMock } from '../platform/testing/opfs_mock.js';
import { ELECTRON_FILE_SYSTEM } from '../platform/electron_fs.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The core that the backends ask about the names of attachments and the changes of the workbook tree
let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// The desktop app of the tests, its file system is a mock
const electron = globalThis as { dashqlElectron?: unknown };

const OTHER_WORKBOOK_ID = '22222222-3333-4444-8555-666666666666';

class Registry extends WorkbookTestRegistry {
    legacyDrafts = new Set<string>();
    override async loadScripts(id: string) {
        if (this.legacyDrafts.has(id)) {
            throw new Error('Invalid V2 workbook layout: dashql-draft.sql is not supported');
        }
        return await super.loadScripts(id);
    }
    override async deleteWorkbookFiles(id: string): Promise<void> {
        this.legacyDrafts.delete(id);
        await super.deleteWorkbookFiles(id);
    }
}

describe('CompositeStorageBackend V2 flat routing', () => {
    let registry: Registry;
    let backend: CompositeStorageBackend;

    beforeEach(async () => {
        resetFsStore();
        electron.dashqlElectron = { fs: makeFsMock() };
        registry = new Registry(dql);
        backend = new CompositeStorageBackend(dql, registry, new TestLogger());
        await backend.initialize();
    });

    afterEach(() => {
        delete electron.dashqlElectron;
    });

    it('routes unknown and OPFS workbooks to the registry backend', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.OPFS }]);
        expect(fsStore.files.size).toBe(0);
    });

    it('mirrors native attachment bytes into the OPFS UUID namespace before returning a workbook', async () => {
        const opfs = new OPFSStorageBackend(dql);
        const composite = new CompositeStorageBackend(dql, opfs, new TestLogger());
        await composite.initialize();
        const native = new NativeStorageBackend('/tmp/native-attachments', ELECTRON_FILE_SYSTEM);
        const bytes = new Uint8Array([0, 128, 255, 10]);
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await native.saveDataFile(TEST_WORKBOOK_ID, 'data.parquet', bytes);
        try {
            await composite.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
            await composite.loadWorkbook(TEST_WORKBOOK_ID);
            await expect(opfs.loadDataFile(TEST_WORKBOOK_ID, 'data.parquet')).resolves.toEqual(bytes);
            const root = await getOPFSRoot();
            const workbooks = await root.getDirectoryHandle('workbooks');
            const workbook = await workbooks.getDirectoryHandle(TEST_WORKBOOK_ID);
            const attachments = await workbook.getDirectoryHandle('attachments');
            const file = await attachments.getFileHandle('data.parquet');
            expect(new Uint8Array(await (await file.getFile()).arrayBuffer())).toEqual(bytes);
        } finally {
            await opfs.deleteWorkbook(TEST_WORKBOOK_ID);
        }
    });

    it('refreshes the complete native attachment mirror and removes stale files without native writes', async () => {
        const native = new NativeStorageBackend('/tmp/native-refresh', ELECTRON_FILE_SYSTEM);
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await native.saveDataFile(TEST_WORKBOOK_ID, 'first.parquet', new Uint8Array([1]));
        await native.saveDataFile(TEST_WORKBOOK_ID, 'second.parquet', new Uint8Array([2]));
        await registry.saveDataFile(TEST_WORKBOOK_ID, 'first.parquet', new Uint8Array([0]));
        await registry.saveDataFile(TEST_WORKBOOK_ID, 'stale.parquet', new Uint8Array([3]));
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        const before = { files: new Map(fsStore.files), bytes: new Map(fsStore.binFiles), dirs: new Set(fsStore.dirs), mtimes: new Map(fsStore.mtimes) };
        await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect((await registry.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'first.parquet', sizeBytes: 1 }, { name: 'second.parquet', sizeBytes: 1 }]);
        expect(await registry.loadDataFile(TEST_WORKBOOK_ID, 'first.parquet')).toEqual(new Uint8Array([1]));
        expect(await registry.loadDataFile(TEST_WORKBOOK_ID, 'second.parquet')).toEqual(new Uint8Array([2]));
        expect({ files: fsStore.files, bytes: fsStore.binFiles, dirs: fsStore.dirs, mtimes: fsStore.mtimes }).toEqual(before);
        await native.deleteDataFile(TEST_WORKBOOK_ID, 'first.parquet');
        await native.deleteDataFile(TEST_WORKBOOK_ID, 'second.parquet');
        await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect(await registry.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('copies only the native attachments that changed since they were mirrored', async () => {
        const native = new NativeStorageBackend('/tmp/native-unchanged', ELECTRON_FILE_SYSTEM);
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await native.saveDataFile(TEST_WORKBOOK_ID, 'first.parquet', new Uint8Array([1]));
        await native.saveDataFile(TEST_WORKBOOK_ID, 'second.parquet', new Uint8Array([2]));
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.loadWorkbook(TEST_WORKBOOK_ID);
        const copies = vi.spyOn(registry, 'saveDataFile');
        await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect(copies).not.toHaveBeenCalled();
        await native.saveDataFile(TEST_WORKBOOK_ID, 'second.parquet', new Uint8Array([3]));
        await backend.loadWorkbook(TEST_WORKBOOK_ID);
        expect(copies.mock.calls.map(call => call[1])).toEqual(['second.parquet']);
        expect(await registry.loadDataFile(TEST_WORKBOOK_ID, 'second.parquet')).toEqual(new Uint8Array([3]));
    });

    it('mirrors native attachment saves through the composite backend', async () => {
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: '/tmp/native-save' });
        const bytes = new Uint8Array([0, 255]);
        await backend.saveDataFile(TEST_WORKBOOK_ID, 'saved.parquet', bytes);
        await expect(registry.loadDataFile(TEST_WORKBOOK_ID, 'saved.parquet')).resolves.toEqual(bytes);
        expect(await backend.loadDataFile(TEST_WORKBOOK_ID, 'saved.parquet')).toEqual(bytes);
    });

    it('mirrors native attachment deletes through the composite backend', async () => {
        const native = new NativeStorageBackend('/tmp/native-delete', ELECTRON_FILE_SYSTEM);
        await native.saveDataFile(TEST_WORKBOOK_ID, 'deleted.parquet', new Uint8Array([1]));
        await registry.saveDataFile(TEST_WORKBOOK_ID, 'deleted.parquet', new Uint8Array([1]));
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.deleteDataFile(TEST_WORKBOOK_ID, 'deleted.parquet');
        expect(await registry.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
        expect(await native.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('mirrors native attachment renames even when the source has not been mirrored', async () => {
        const native = new NativeStorageBackend('/tmp/native-rename', ELECTRON_FILE_SYSTEM);
        const bytes = new Uint8Array([128, 255]);
        await native.saveDataFile(TEST_WORKBOOK_ID, 'old.parquet', bytes);
        await registry.saveDataFile(TEST_WORKBOOK_ID, 'new.parquet', new Uint8Array([0]));
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.renameDataFile(TEST_WORKBOOK_ID, 'old.parquet', 'new.parquet');
        await expect(registry.loadDataFile(TEST_WORKBOOK_ID, 'new.parquet')).resolves.toEqual(bytes);
        expect((await registry.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'new.parquet', sizeBytes: 2 }]);
        expect((await native.listDataFiles(TEST_WORKBOOK_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'new.parquet', sizeBytes: 2 }]);
    });

    it('routes flat CRUD to a registered native directory and preserves files on unregister', async () => {
        const dir = '/tmp/native-v2';
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, { ...testWorkbook(), storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.renameScript(TEST_WORKBOOK_ID, '01_query.sql', '02_renamed.sql');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '02_renamed.sql', sql: 'SELECT 1' }]);
        expect(fsStore.files.get(`${dir}/scripts/02_renamed.sql`)).toBe('SELECT 1');
        const before = new Map(fsStore.files);
        await backend.deleteWorkbook(TEST_WORKBOOK_ID);
        expect(registry.manifest).toEqual([]);
        expect(fsStore.files).toEqual(before);
    });

    it('keeps the workbook order in step with the registry', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveWorkbookManifest(OTHER_WORKBOOK_ID, testWorkbook({ workbookId: OTHER_WORKBOOK_ID }));
        await backend.moveWorkbook(OTHER_WORKBOOK_ID, [], 0);
        expect(backend.getWorkbookOrder()).toEqual([OTHER_WORKBOOK_ID, TEST_WORKBOOK_ID]);
        expect(registry.manifest.map(entry => entry.path)).toEqual([OTHER_WORKBOOK_ID, TEST_WORKBOOK_ID]);
    });

    it('mirrors the folders of the workbook tree', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveWorkbookManifest(OTHER_WORKBOOK_ID, testWorkbook({ workbookId: OTHER_WORKBOOK_ID }));
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveWorkbook(TEST_WORKBOOK_ID, ['clients', 'acme'], 0);
        const tree = backend.getWorkbookTree();
        expect(tree.workbooks.map(entry => entry.path)).toEqual([OTHER_WORKBOOK_ID]);
        expect(tree.folders[0].folders[0].workbooks.map(entry => entry.path)).toEqual([TEST_WORKBOOK_ID]);
        // The subfolders of a folder come before its workbooks
        expect(backend.getWorkbookOrder()).toEqual([TEST_WORKBOOK_ID, OTHER_WORKBOOK_ID]);

        await backend.deleteFolder(['clients']);
        expect(backend.getWorkbookTree().folders).toEqual([]);
        expect(backend.getWorkbookOrder()).toEqual([OTHER_WORKBOOK_ID, TEST_WORKBOOK_ID]);
    });

    it('routes a native workbook of a nested folder after a refresh', async () => {
        const dir = '/tmp/nested';
        await backend.createFolder(['clients']);
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir }, ['clients']);
        const fresh = new CompositeStorageBackend(dql, registry, new TestLogger());
        await fresh.initialize();
        expect(fresh.getWorkbookLocation(TEST_WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: dir });
        expect(fresh.getWorkbookTree().folders[0].workbooks).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
    });

    it('relocates an OPFS workbook into a native directory', async () => {
        const dir = '/tmp/relocated';
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.relocateWorkbookToNative(TEST_WORKBOOK_ID, dir);

        expect(fsStore.files.get(`${dir}/scripts/01_query.sql`)).toBe('SELECT 1');
        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
        expect(registry.scripts.has(TEST_WORKBOOK_ID)).toBe(false);
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        await expect(backend.relocateWorkbookToNative(TEST_WORKBOOK_ID, '/tmp/again')).rejects.toThrow('is not an OPFS workbook');
    });

    it('keeps the results of a workbook that moves to a native folder in the origin private file system', async () => {
        const dir = '/tmp/relocated-results';
        const files = new Map<string, string | ArrayBuffer>();
        const dirs = new Set<string>();
        const opfs = new OPFSStorageBackend(dql, async () => new OPFSDirectoryMock('', files, dirs) as unknown as FileSystemDirectoryHandle);
        const composite = new CompositeStorageBackend(dql, opfs, new TestLogger());
        await composite.initialize();
        await composite.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await composite.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await composite.saveDataFile(TEST_WORKBOOK_ID, 'a.parquet', new Uint8Array([1, 2, 3]));
        const result = `workbooks/${TEST_WORKBOOK_ID}/results/01_query.${'0'.repeat(64)}.${'0'.repeat(20)}.parquet`;
        dirs.add(`workbooks/${TEST_WORKBOOK_ID}/results`);
        files.set(result, 'parquet');

        await composite.relocateWorkbookToNative(TEST_WORKBOOK_ID, dir);

        expect(fsStore.files.get(`${dir}/scripts/01_query.sql`)).toBe('SELECT 1');
        // The workbook file, the scripts and the attachments left the origin private file system, the results stay
        expect([...files.keys()].filter(path => path.startsWith(`workbooks/${TEST_WORKBOOK_ID}/`))).toEqual([result]);
        expect(composite.getWorkbookLocation(TEST_WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: dir });
    });

    it('registers a native folder in place of an OPFS workbook and drops the files of the old one', async () => {
        const dir = '/tmp/selected';
        const native = new NativeStorageBackend(dir, ELECTRON_FILE_SYSTEM);
        await native.initialize();
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, { ...testWorkbook(), storageType: StorageBackendType.Native, nativePath: dir });
        await native.saveScript(TEST_WORKBOOK_ID, '02_native.sql', 'SELECT 2');
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');

        await backend.registerNativeWorkbook(dir, TEST_WORKBOOK_ID);

        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
        expect(registry.scripts.has(TEST_WORKBOOK_ID)).toBe(false);
        expect(backend.getWorkbookLocation(TEST_WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: dir });
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '02_native.sql', sql: 'SELECT 2' }]);
    });

    it('registers a native folder of an older version, the runtime migrates it through the folder of the workbook', async () => {
        const dir = '/tmp/session';
        const { workbookId, ...workbook } = testWorkbook();
        fsStore.files.set(`${dir}/dashql-session.json`, JSON.stringify({ ...workbook, formatVersion: 10, sessionId: workbookId }));
        await backend.registerNativeWorkbook(dir, workbookId);
        expect(fsStore.files.has(`${dir}/dashql-session.json`)).toBe(true);
        const runtime = createRuntime({
            logger: new TestLogger(),
            scheduler: TASK_UPDATE_SCHEDULER,
            core: await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }),
            storage: backend,
        });
        try {
            expect(await runtime.module.migrateWorkbookFolder(workbookId)).toBe('migrated');
        } finally {
            await runtime.destroy();
        }
        expect(fsStore.files.has(`${dir}/dashql-session.json`)).toBe(false);
        expect(JSON.parse(fsStore.files.get(`${dir}/dashql-workbook.json`)!)).toMatchObject({ workbookId });
    });

    it('reads a native folder for an import without creating a missing one', async () => {
        const dir = '/tmp/folder';
        const native = new NativeStorageBackend(dir, ELECTRON_FILE_SYSTEM);
        await native.initialize();
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await native.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        await native.saveDataFile(TEST_WORKBOOK_ID, 'payload.parquet', new Uint8Array([1, 2, 3]));

        const folder = backend.importFolder(dir);
        expect(folder.nativePath).toBe(dir);
        expect(JSON.parse((await folder.readText('dashql-workbook.json'))!)).toMatchObject({ workbookId: TEST_WORKBOOK_ID });
        expect(await folder.scripts([])).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        expect(await folder.attachments([])).toEqual([{ name: 'payload.parquet', file: new Uint8Array([1, 2, 3]) }]);

        const missing = backend.importFolder('/tmp/missing');
        expect(await missing.readText('dashql-workbook.json')).toBeNull();
        expect(fsStore.dirs.has('/tmp/missing')).toBe(false);
        // Nothing is registered by reading
        expect(registry.manifest).toEqual([]);
    });
});
