import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../platform/logger/test_logger.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import { WorkbookTestRegistry, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from './workbook_test_backend.js';
import { fsStore, makeFsMock, resetFsStore } from './test_fs_mock.js';
import {
    findWorkbookImportConflict,
    prepareNativeWorkbookImport,
    registerNativeWorkbook,
    replaceWorkbookWithNativeFolder,
    replaceWorkbookWithPortableBundle,
    writePortableWorkbookFresh,
} from './workbook_import_transaction.js';
import { getOPFSRoot } from '../platform/opfs_root.js';

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
        globalThis.dashqlElectron = { fs: makeFsMock() } as unknown as DashQLElectronBridge;
        registry = new Registry();
        backend = new CompositeStorageBackend(registry, new TestLogger());
        await backend.initialize();
    });

    afterEach(() => {
        delete globalThis.dashqlElectron;
    });

    it('routes unknown and OPFS workbooks to the registry backend', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.OPFS }]);
        expect(fsStore.files.size).toBe(0);
    });

    it('mirrors native attachment bytes into the OPFS UUID namespace before returning a workbook', async () => {
        const opfs = new OPFSStorageBackend();
        const composite = new CompositeStorageBackend(opfs, new TestLogger());
        await composite.initialize();
        const native = new NativeStorageBackend('/tmp/native-attachments');
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
        const native = new NativeStorageBackend('/tmp/native-refresh');
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
        const native = new NativeStorageBackend('/tmp/native-unchanged');
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
        const native = new NativeStorageBackend('/tmp/native-delete');
        await native.saveDataFile(TEST_WORKBOOK_ID, 'deleted.parquet', new Uint8Array([1]));
        await registry.saveDataFile(TEST_WORKBOOK_ID, 'deleted.parquet', new Uint8Array([1]));
        await backend.upsertWorkbookEntry({ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.deleteDataFile(TEST_WORKBOOK_ID, 'deleted.parquet');
        expect(await registry.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
        expect(await native.listDataFiles(TEST_WORKBOOK_ID)).toEqual([]);
    });

    it('mirrors native attachment renames even when the source has not been mirrored', async () => {
        const native = new NativeStorageBackend('/tmp/native-rename');
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
        const fresh = new CompositeStorageBackend(registry, new TestLogger());
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

    it('replaces a persisted V1 workbook with a legacy draft under the same stable UUID', async () => {
        await registry.saveWorkbookManifest(TEST_WORKBOOK_ID, {
            ...testWorkbook(),
            formatVersion: 1,
        } as any);
        await registry.saveScript(TEST_WORKBOOK_ID, 'legacy.sql', 'SELECT 0');
        registry.legacyDrafts.add(TEST_WORKBOOK_ID);
        await backend.refreshLocations();

        const source = {
            workbook: testWorkbook(),
            catalogs: [],
            scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
        };
        await replaceWorkbookWithPortableBundle(backend, source, {
            workbookId: TEST_WORKBOOK_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => '99999999-8888-4777-8666-555555555555' });

        expect(await backend.loadWorkbook(TEST_WORKBOOK_ID)).toEqual(testWorkbook({ scripts: [{ name: '01_query.sql', connectionId: TEST_CONNECTION_ID }] }));
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it('replaces an OPFS workbook with a selected native folder of the same workbook', async () => {
        const dir = '/tmp/selected';
        const native = new NativeStorageBackend(dir);
        await native.initialize();
        await native.saveWorkbookManifest(TEST_WORKBOOK_ID, { ...testWorkbook(), storageType: StorageBackendType.Native, nativePath: dir });
        await native.saveScript(TEST_WORKBOOK_ID, '02_native.sql', 'SELECT 2');
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');

        const prepared = await prepareNativeWorkbookImport(backend, dir);
        const conflict = { workbookId: TEST_WORKBOOK_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceWorkbookWithNativeFolder(backend, prepared, { ...conflict, workbookId: OTHER_WORKBOOK_ID })).rejects.toThrow('does not match');
        expect(await replaceWorkbookWithNativeFolder(backend, prepared, conflict)).toBe(TEST_WORKBOOK_ID);

        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
        expect(registry.scripts.has(TEST_WORKBOOK_ID)).toBe(false);
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '02_native.sql', sql: 'SELECT 2' }]);
        // The folder that is registered already needs no replacement
        await expect(replaceWorkbookWithNativeFolder(backend, prepared, { workbookId: TEST_WORKBOOK_ID, location: { type: StorageBackendType.Native, nativePath: dir } })).resolves.toBe(TEST_WORKBOOK_ID);
    });

    it('imports workbooks that share their connections with other workbooks', async () => {
        // Connections are global, an import may use a connection that other workbooks use too
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const source = {
            workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID }),
            catalogs: [],
            scripts: [],
        };
        await expect(writePortableWorkbookFresh(backend, source)).resolves.toBe(OTHER_WORKBOOK_ID);
        expect((await backend.loadWorkbook(OTHER_WORKBOOK_ID)).connections.map(connection => connection.connectionId)).toEqual([TEST_CONNECTION_ID]);

        await expect(replaceWorkbookWithPortableBundle(backend, { ...source, workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID, name: 'Replaced' }) }, {
            workbookId: OTHER_WORKBOOK_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => '99999999-8888-4777-8666-555555555555' })).resolves.toBe(OTHER_WORKBOOK_ID);
        expect((await backend.loadWorkbook(OTHER_WORKBOOK_ID)).name).toBe('Replaced');
    });
});

describe('workbook import transactions', () => {
    const STAGING_ID = '99999999-8888-4777-8666-555555555555';
    let registry: Registry;
    let backend: CompositeStorageBackend;

    beforeEach(async () => {
        resetFsStore();
        globalThis.dashqlElectron = { fs: makeFsMock() } as unknown as DashQLElectronBridge;
        registry = new Registry();
        backend = new CompositeStorageBackend(registry, new TestLogger());
        await backend.initialize();
    });

    afterEach(() => {
        delete globalThis.dashqlElectron;
        vi.restoreAllMocks();
    });

    /// A native workbook folder that is ready for import
    async function nativeFolder(dir: string, workbookId = TEST_WORKBOOK_ID) {
        const native = new NativeStorageBackend(dir);
        await native.initialize();
        await native.saveWorkbookManifest(workbookId, { ...testWorkbook({ workbookId }), storageType: StorageBackendType.Native, nativePath: dir });
        await native.saveScript(workbookId, '02_native.sql', 'SELECT 2');
        return await prepareNativeWorkbookImport(backend, dir);
    }

    it('registers a native folder under its own UUID', async () => {
        const prepared = await nativeFolder('/tmp/import', OTHER_WORKBOOK_ID);
        expect(await findWorkbookImportConflict(backend, OTHER_WORKBOOK_ID)).toBeNull();
        await expect(registerNativeWorkbook(backend, prepared)).resolves.toBe(OTHER_WORKBOOK_ID);
        expect(registry.manifest).toEqual([{ path: OTHER_WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: '/tmp/import' }]);
        expect(await backend.loadScripts(OTHER_WORKBOOK_ID)).toEqual([{ name: '02_native.sql', sql: 'SELECT 2' }]);
        expect(await findWorkbookImportConflict(backend, OTHER_WORKBOOK_ID)).not.toBeNull();
        await expect(registerNativeWorkbook(backend, prepared)).rejects.toThrow('is already registered');
    });

    it('rejects a fresh portable write over a registered workbook', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const source = { workbook: testWorkbook(), catalogs: [], scripts: [] };
        await expect(writePortableWorkbookFresh(backend, source)).rejects.toThrow('is already registered');
    });

    it('deletes a fresh portable write that does not verify', async () => {
        const source = { workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID }), catalogs: [], scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }] };
        vi.spyOn(backend, 'readPortableWorkbookBundle').mockResolvedValue({ ...source, scripts: [] });
        const deleted = vi.spyOn(backend, 'deletePortableWorkbook');
        await expect(writePortableWorkbookFresh(backend, source)).rejects.toThrow(
            `verification failed for ${OTHER_WORKBOOK_ID}: the scripts differ: expected [01_query.sql], found []`);
        expect(deleted).toHaveBeenCalledWith(OTHER_WORKBOOK_ID);
        expect(registry.manifest).toEqual([]);
    });

    it('names the field of the workbook file that does not verify', async () => {
        const source = { workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID, metadata: { originalFileName: 'stocks' } }), catalogs: [], scripts: [] };
        vi.spyOn(backend, 'readPortableWorkbookBundle').mockResolvedValue({ ...source, workbook: { ...source.workbook, metadata: {} } });
        await expect(writePortableWorkbookFresh(backend, source)).rejects.toThrow(
            `verification failed for ${OTHER_WORKBOOK_ID}: workbook.metadata.originalFileName differs`);
    });

    it('writes a workbook whose scripts and attachments are not in the order of their names', async () => {
        // A bundle from workbook tables lists the files in the order of the workbook, the storage by name
        const source = {
            workbook: testWorkbook({
                workbookId: OTHER_WORKBOOK_ID,
                scripts: [
                    { name: 'prices.sql', connectionId: TEST_CONNECTION_ID },
                    { name: 'dashboard.sql', connectionId: TEST_CONNECTION_ID },
                ],
                attachments: [{ name: 'quotes.parquet' }, { name: 'companies.parquet' }],
            }),
            catalogs: [],
            scripts: [{ name: 'prices.sql', sql: 'SELECT 1' }, { name: 'dashboard.sql', sql: 'SELECT 2' }],
            data: [
                { name: 'quotes.parquet', bytes: new Uint8Array([1, 2]) },
                { name: 'companies.parquet', bytes: new Uint8Array([3]) },
            ],
        };
        await expect(writePortableWorkbookFresh(backend, source)).resolves.toBe(OTHER_WORKBOOK_ID);
        expect((await backend.loadWorkbook(OTHER_WORKBOOK_ID)).scripts.map(script => script.name)).toEqual(['prices.sql', 'dashboard.sql']);
    });

    it('keeps the import error when the cleanup of a fresh write fails too', async () => {
        const source = { workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID }), catalogs: [], scripts: [] };
        vi.spyOn(backend, 'writePortableWorkbookBundle').mockRejectedValue(new Error('disk full'));
        vi.spyOn(backend, 'deletePortableWorkbook').mockRejectedValue(new Error('locked'));
        await expect(writePortableWorkbookFresh(backend, source)).rejects.toThrow('disk full');
    });

    it('checks the replacement before touching the registered workbook', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        const conflict = { workbookId: TEST_WORKBOOK_ID, location: { type: StorageBackendType.OPFS } } as const;
        const source = { workbook: testWorkbook(), catalogs: [], scripts: [] };
        await expect(replaceWorkbookWithPortableBundle(backend, { ...source, workbook: testWorkbook({ workbookId: OTHER_WORKBOOK_ID }) }, conflict))
            .rejects.toThrow('does not match replacement');
        await backend.saveWorkbookManifest(OTHER_WORKBOOK_ID, testWorkbook({ workbookId: OTHER_WORKBOOK_ID }));
        await expect(replaceWorkbookWithPortableBundle(backend, source, conflict, { randomUUID: () => OTHER_WORKBOOK_ID }))
            .rejects.toThrow(`Staging workbook ${OTHER_WORKBOOK_ID} is already registered`);

        const unregistered = { workbookId: STAGING_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceWorkbookWithPortableBundle(backend, { ...source, workbook: testWorkbook({ workbookId: STAGING_ID }) }, unregistered))
            .rejects.toThrow('is no longer registered');
    });

    it('restores the old workbook when the replacement fails after the target changed', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook({ name: 'Old' }));
        await backend.saveScript(TEST_WORKBOOK_ID, '01_old.sql', 'SELECT 0');
        const write = backend.writePortableWorkbookBundle.bind(backend);
        let targetWrites = 0;
        vi.spyOn(backend, 'writePortableWorkbookBundle').mockImplementation(async (bundle, workbookId, fresh) => {
            // Fail the first write of the new bundle into the target, not the restore of the old one
            if (workbookId === TEST_WORKBOOK_ID && targetWrites++ === 0) throw new Error('quota exceeded');
            return await write(bundle, workbookId, fresh);
        });
        const source = { workbook: testWorkbook({ name: 'New' }), catalogs: [], scripts: [{ name: '01_new.sql', sql: 'SELECT 1' }] };
        await expect(replaceWorkbookWithPortableBundle(backend, source, {
            workbookId: TEST_WORKBOOK_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => STAGING_ID })).rejects.toThrow('quota exceeded');

        expect((await backend.loadWorkbook(TEST_WORKBOOK_ID)).name).toBe('Old');
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_old.sql', sql: 'SELECT 0' }]);
        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.OPFS }]);
        expect(await findWorkbookImportConflict(backend, STAGING_ID)).toBeNull();
        expect(registry.scripts.has(STAGING_ID)).toBe(false);
    });

    it('reports a failing staging cleanup of a successful replacement', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        vi.spyOn(backend, 'deletePortableWorkbook').mockRejectedValue(new Error('locked'));
        const source = { workbook: testWorkbook({ name: 'New' }), catalogs: [], scripts: [] };
        await expect(replaceWorkbookWithPortableBundle(backend, source, {
            workbookId: TEST_WORKBOOK_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => STAGING_ID })).rejects.toThrow('locked');
    });

    it('restores the manifest entry when the replacement by a native folder fails', async () => {
        await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, '01_query.sql', 'SELECT 1');
        const prepared = await nativeFolder('/tmp/selected');
        vi.spyOn(backend, 'deletePortableWorkbookFiles').mockRejectedValue(new Error('locked'));
        const conflict = { workbookId: TEST_WORKBOOK_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceWorkbookWithNativeFolder(backend, prepared, conflict)).rejects.toThrow('locked');
        expect(registry.manifest).toEqual([{ path: TEST_WORKBOOK_ID, storageType: StorageBackendType.OPFS }]);
        expect(await backend.loadScripts(TEST_WORKBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });
});
