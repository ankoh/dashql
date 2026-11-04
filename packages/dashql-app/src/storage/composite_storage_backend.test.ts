import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../platform/logger/test_logger.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import { SessionTestRegistry, TEST_CONNECTION_ID, TEST_SESSION_ID, testSession } from './session_test_backend.js';
import { fsStore, makeFsMock, resetFsStore } from './test_fs_mock.js';
import {
    findSessionImportConflict,
    prepareNativeSessionImport,
    registerNativeSession,
    replaceSessionWithNativeFolder,
    replaceSessionWithPortableBundle,
    writePortableSessionFresh,
} from './session_import_transaction.js';
import { getOPFSRoot } from '../platform/opfs_root.js';

const OTHER_SESSION_ID = '22222222-3333-4444-8555-666666666666';

class Registry extends SessionTestRegistry {
    legacyDrafts = new Set<string>();
    override async loadScripts(id: string) {
        if (this.legacyDrafts.has(id)) {
            throw new Error('Invalid V2 session layout: dashql-draft.sql is not supported');
        }
        return await super.loadScripts(id);
    }
    override async deleteSessionFiles(id: string): Promise<void> {
        this.legacyDrafts.delete(id);
        await super.deleteSessionFiles(id);
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

    it('routes unknown and OPFS sessions to the registry backend', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01_query.sql', 'SELECT 1');
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        expect(registry.manifest).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.OPFS }]);
        expect(fsStore.files.size).toBe(0);
    });

    it('mirrors native attachment bytes into the OPFS UUID namespace before returning a session', async () => {
        const opfs = new OPFSStorageBackend();
        const composite = new CompositeStorageBackend(opfs, new TestLogger());
        await composite.initialize();
        const native = new NativeStorageBackend('/tmp/native-attachments');
        const bytes = new Uint8Array([0, 128, 255, 10]);
        await native.saveSessionManifest(TEST_SESSION_ID, testSession());
        await native.saveDataFile(TEST_SESSION_ID, 'data.parquet', bytes);
        try {
            await composite.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
            await composite.loadSession(TEST_SESSION_ID);
            await expect(opfs.loadDataFile(TEST_SESSION_ID, 'data.parquet')).resolves.toEqual(bytes);
            const root = await getOPFSRoot();
            const sessions = await root.getDirectoryHandle('sessions');
            const session = await sessions.getDirectoryHandle(TEST_SESSION_ID);
            const attachments = await session.getDirectoryHandle('attachments');
            const file = await attachments.getFileHandle('data.parquet');
            expect(new Uint8Array(await (await file.getFile()).arrayBuffer())).toEqual(bytes);
        } finally {
            await opfs.deleteSession(TEST_SESSION_ID);
        }
    });

    it('refreshes the complete native attachment mirror and removes stale files without native writes', async () => {
        const native = new NativeStorageBackend('/tmp/native-refresh');
        await native.saveSessionManifest(TEST_SESSION_ID, testSession());
        await native.saveDataFile(TEST_SESSION_ID, 'first.parquet', new Uint8Array([1]));
        await native.saveDataFile(TEST_SESSION_ID, 'second.parquet', new Uint8Array([2]));
        await registry.saveDataFile(TEST_SESSION_ID, 'first.parquet', new Uint8Array([0]));
        await registry.saveDataFile(TEST_SESSION_ID, 'stale.parquet', new Uint8Array([3]));
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        const before = { files: new Map(fsStore.files), bytes: new Map(fsStore.binFiles), dirs: new Set(fsStore.dirs), mtimes: new Map(fsStore.mtimes) };
        await backend.loadSession(TEST_SESSION_ID);
        expect((await registry.listDataFiles(TEST_SESSION_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'first.parquet', sizeBytes: 1 }, { name: 'second.parquet', sizeBytes: 1 }]);
        expect(await registry.loadDataFile(TEST_SESSION_ID, 'first.parquet')).toEqual(new Uint8Array([1]));
        expect(await registry.loadDataFile(TEST_SESSION_ID, 'second.parquet')).toEqual(new Uint8Array([2]));
        expect({ files: fsStore.files, bytes: fsStore.binFiles, dirs: fsStore.dirs, mtimes: fsStore.mtimes }).toEqual(before);
        await native.deleteDataFile(TEST_SESSION_ID, 'first.parquet');
        await native.deleteDataFile(TEST_SESSION_ID, 'second.parquet');
        await backend.loadSession(TEST_SESSION_ID);
        expect(await registry.listDataFiles(TEST_SESSION_ID)).toEqual([]);
    });

    it('copies only the native attachments that changed since they were mirrored', async () => {
        const native = new NativeStorageBackend('/tmp/native-unchanged');
        await native.saveSessionManifest(TEST_SESSION_ID, testSession());
        await native.saveDataFile(TEST_SESSION_ID, 'first.parquet', new Uint8Array([1]));
        await native.saveDataFile(TEST_SESSION_ID, 'second.parquet', new Uint8Array([2]));
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.loadSession(TEST_SESSION_ID);
        const copies = vi.spyOn(registry, 'saveDataFile');
        await backend.loadSession(TEST_SESSION_ID);
        expect(copies).not.toHaveBeenCalled();
        await native.saveDataFile(TEST_SESSION_ID, 'second.parquet', new Uint8Array([3]));
        await backend.loadSession(TEST_SESSION_ID);
        expect(copies.mock.calls.map(call => call[1])).toEqual(['second.parquet']);
        expect(await registry.loadDataFile(TEST_SESSION_ID, 'second.parquet')).toEqual(new Uint8Array([3]));
    });

    it('mirrors native attachment saves through the composite backend', async () => {
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: '/tmp/native-save' });
        const bytes = new Uint8Array([0, 255]);
        await backend.saveDataFile(TEST_SESSION_ID, 'saved.parquet', bytes);
        await expect(registry.loadDataFile(TEST_SESSION_ID, 'saved.parquet')).resolves.toEqual(bytes);
        expect(await backend.loadDataFile(TEST_SESSION_ID, 'saved.parquet')).toEqual(bytes);
    });

    it('mirrors native attachment deletes through the composite backend', async () => {
        const native = new NativeStorageBackend('/tmp/native-delete');
        await native.saveDataFile(TEST_SESSION_ID, 'deleted.parquet', new Uint8Array([1]));
        await registry.saveDataFile(TEST_SESSION_ID, 'deleted.parquet', new Uint8Array([1]));
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.deleteDataFile(TEST_SESSION_ID, 'deleted.parquet');
        expect(await registry.listDataFiles(TEST_SESSION_ID)).toEqual([]);
        expect(await native.listDataFiles(TEST_SESSION_ID)).toEqual([]);
    });

    it('mirrors native attachment renames even when the source has not been mirrored', async () => {
        const native = new NativeStorageBackend('/tmp/native-rename');
        const bytes = new Uint8Array([128, 255]);
        await native.saveDataFile(TEST_SESSION_ID, 'old.parquet', bytes);
        await registry.saveDataFile(TEST_SESSION_ID, 'new.parquet', new Uint8Array([0]));
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: native.getDir() });
        await backend.renameDataFile(TEST_SESSION_ID, 'old.parquet', 'new.parquet');
        await expect(registry.loadDataFile(TEST_SESSION_ID, 'new.parquet')).resolves.toEqual(bytes);
        expect((await registry.listDataFiles(TEST_SESSION_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'new.parquet', sizeBytes: 2 }]);
        expect((await native.listDataFiles(TEST_SESSION_ID)).map(({ name, sizeBytes }) => ({ name, sizeBytes }))).toEqual([{ name: 'new.parquet', sizeBytes: 2 }]);
    });

    it('routes flat CRUD to a registered native directory and preserves files on unregister', async () => {
        const dir = '/tmp/native-v2';
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveSessionManifest(TEST_SESSION_ID, { ...testSession(), storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveScript(TEST_SESSION_ID, '01_query.sql', 'SELECT 1');
        await backend.renameScript(TEST_SESSION_ID, '01_query.sql', '02_renamed.sql');
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '02_renamed.sql', sql: 'SELECT 1' }]);
        expect(fsStore.files.get(`${dir}/scripts/02_renamed.sql`)).toBe('SELECT 1');
        const before = new Map(fsStore.files);
        await backend.deleteSession(TEST_SESSION_ID);
        expect(registry.manifest).toEqual([]);
        expect(fsStore.files).toEqual(before);
    });

    it('keeps the session order in step with the registry', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveSessionManifest(OTHER_SESSION_ID, testSession({ sessionId: OTHER_SESSION_ID }));
        await backend.moveSession(OTHER_SESSION_ID, [], 0);
        expect(backend.getSessionOrder()).toEqual([OTHER_SESSION_ID, TEST_SESSION_ID]);
        expect(registry.manifest.map(entry => entry.path)).toEqual([OTHER_SESSION_ID, TEST_SESSION_ID]);
    });

    it('mirrors the folders of the session tree', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveSessionManifest(OTHER_SESSION_ID, testSession({ sessionId: OTHER_SESSION_ID }));
        await backend.createFolder(['clients']);
        await backend.createFolder(['clients', 'acme']);
        await backend.moveSession(TEST_SESSION_ID, ['clients', 'acme'], 0);
        const tree = backend.getSessionTree();
        expect(tree.sessions.map(entry => entry.path)).toEqual([OTHER_SESSION_ID]);
        expect(tree.folders[0].folders[0].sessions.map(entry => entry.path)).toEqual([TEST_SESSION_ID]);
        // The subfolders of a folder come before its sessions
        expect(backend.getSessionOrder()).toEqual([TEST_SESSION_ID, OTHER_SESSION_ID]);

        await backend.deleteFolder(['clients']);
        expect(backend.getSessionTree().folders).toEqual([]);
        expect(backend.getSessionOrder()).toEqual([OTHER_SESSION_ID, TEST_SESSION_ID]);
    });

    it('routes a native session of a nested folder after a refresh', async () => {
        const dir = '/tmp/nested';
        await backend.createFolder(['clients']);
        await backend.upsertSessionEntry({ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: dir }, ['clients']);
        const fresh = new CompositeStorageBackend(registry, new TestLogger());
        await fresh.initialize();
        expect(fresh.getSessionLocation(TEST_SESSION_ID)).toEqual({ type: StorageBackendType.Native, nativePath: dir });
        expect(fresh.getSessionTree().folders[0].sessions).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
    });

    it('relocates an OPFS session into a native directory', async () => {
        const dir = '/tmp/relocated';
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01_query.sql', 'SELECT 1');
        await backend.relocateSessionToNative(TEST_SESSION_ID, dir);

        expect(fsStore.files.get(`${dir}/scripts/01_query.sql`)).toBe('SELECT 1');
        expect(registry.manifest).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
        expect(registry.scripts.has(TEST_SESSION_ID)).toBe(false);
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        await expect(backend.relocateSessionToNative(TEST_SESSION_ID, '/tmp/again')).rejects.toThrow('is not an OPFS session');
    });

    it('replaces a persisted V1 session with a legacy draft under the same stable UUID', async () => {
        await registry.saveSessionManifest(TEST_SESSION_ID, {
            ...testSession(),
            formatVersion: 1,
        } as any);
        await registry.saveScript(TEST_SESSION_ID, 'legacy.sql', 'SELECT 0');
        registry.legacyDrafts.add(TEST_SESSION_ID);
        await backend.refreshLocations();

        const source = {
            session: testSession(),
            catalogs: [],
            scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
        };
        await replaceSessionWithPortableBundle(backend, source, {
            sessionId: TEST_SESSION_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => '99999999-8888-4777-8666-555555555555' });

        expect(await backend.loadSession(TEST_SESSION_ID)).toEqual(testSession({ scripts: [{ name: '01_query.sql', connectionId: TEST_CONNECTION_ID }] }));
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it('replaces an OPFS session with a selected native folder of the same session', async () => {
        const dir = '/tmp/selected';
        const native = new NativeStorageBackend(dir);
        await native.initialize();
        await native.saveSessionManifest(TEST_SESSION_ID, { ...testSession(), storageType: StorageBackendType.Native, nativePath: dir });
        await native.saveScript(TEST_SESSION_ID, '02_native.sql', 'SELECT 2');
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01_query.sql', 'SELECT 1');

        const prepared = await prepareNativeSessionImport(backend, dir);
        const conflict = { sessionId: TEST_SESSION_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceSessionWithNativeFolder(backend, prepared, { ...conflict, sessionId: OTHER_SESSION_ID })).rejects.toThrow('does not match');
        expect(await replaceSessionWithNativeFolder(backend, prepared, conflict)).toBe(TEST_SESSION_ID);

        expect(registry.manifest).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.Native, nativePath: dir }]);
        expect(registry.scripts.has(TEST_SESSION_ID)).toBe(false);
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '02_native.sql', sql: 'SELECT 2' }]);
        // The folder that is registered already needs no replacement
        await expect(replaceSessionWithNativeFolder(backend, prepared, { sessionId: TEST_SESSION_ID, location: { type: StorageBackendType.Native, nativePath: dir } })).resolves.toBe(TEST_SESSION_ID);
    });

    it('imports sessions that share their connections with other sessions', async () => {
        // Connections are global, an import may use a connection that other sessions use too
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        const source = {
            session: testSession({ sessionId: OTHER_SESSION_ID }),
            catalogs: [],
            scripts: [],
        };
        await expect(writePortableSessionFresh(backend, source)).resolves.toBe(OTHER_SESSION_ID);
        expect((await backend.loadSession(OTHER_SESSION_ID)).connections.map(connection => connection.connectionId)).toEqual([TEST_CONNECTION_ID]);

        await expect(replaceSessionWithPortableBundle(backend, { ...source, session: testSession({ sessionId: OTHER_SESSION_ID, name: 'Replaced' }) }, {
            sessionId: OTHER_SESSION_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => '99999999-8888-4777-8666-555555555555' })).resolves.toBe(OTHER_SESSION_ID);
        expect((await backend.loadSession(OTHER_SESSION_ID)).name).toBe('Replaced');
    });
});

describe('session import transactions', () => {
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

    /// A native session folder that is ready for import
    async function nativeFolder(dir: string, sessionId = TEST_SESSION_ID) {
        const native = new NativeStorageBackend(dir);
        await native.initialize();
        await native.saveSessionManifest(sessionId, { ...testSession({ sessionId }), storageType: StorageBackendType.Native, nativePath: dir });
        await native.saveScript(sessionId, '02_native.sql', 'SELECT 2');
        return await prepareNativeSessionImport(backend, dir);
    }

    it('registers a native folder under its own UUID', async () => {
        const prepared = await nativeFolder('/tmp/import', OTHER_SESSION_ID);
        expect(await findSessionImportConflict(backend, OTHER_SESSION_ID)).toBeNull();
        await expect(registerNativeSession(backend, prepared)).resolves.toBe(OTHER_SESSION_ID);
        expect(registry.manifest).toEqual([{ path: OTHER_SESSION_ID, storageType: StorageBackendType.Native, nativePath: '/tmp/import' }]);
        expect(await backend.loadScripts(OTHER_SESSION_ID)).toEqual([{ name: '02_native.sql', sql: 'SELECT 2' }]);
        expect(await findSessionImportConflict(backend, OTHER_SESSION_ID)).not.toBeNull();
        await expect(registerNativeSession(backend, prepared)).rejects.toThrow('is already registered');
    });

    it('rejects a fresh portable write over a registered session', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        const source = { session: testSession(), catalogs: [], scripts: [] };
        await expect(writePortableSessionFresh(backend, source)).rejects.toThrow('is already registered');
    });

    it('deletes a fresh portable write that does not verify', async () => {
        const source = { session: testSession({ sessionId: OTHER_SESSION_ID }), catalogs: [], scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }] };
        vi.spyOn(backend, 'readPortableSessionBundle').mockResolvedValue({ ...source, scripts: [] });
        const deleted = vi.spyOn(backend, 'deletePortableSession');
        await expect(writePortableSessionFresh(backend, source)).rejects.toThrow(`verification failed for ${OTHER_SESSION_ID}`);
        expect(deleted).toHaveBeenCalledWith(OTHER_SESSION_ID);
        expect(registry.manifest).toEqual([]);
    });

    it('keeps the import error when the cleanup of a fresh write fails too', async () => {
        const source = { session: testSession({ sessionId: OTHER_SESSION_ID }), catalogs: [], scripts: [] };
        vi.spyOn(backend, 'writePortableSessionBundle').mockRejectedValue(new Error('disk full'));
        vi.spyOn(backend, 'deletePortableSession').mockRejectedValue(new Error('locked'));
        await expect(writePortableSessionFresh(backend, source)).rejects.toThrow('disk full');
    });

    it('checks the replacement before touching the registered session', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        const conflict = { sessionId: TEST_SESSION_ID, location: { type: StorageBackendType.OPFS } } as const;
        const source = { session: testSession(), catalogs: [], scripts: [] };
        await expect(replaceSessionWithPortableBundle(backend, { ...source, session: testSession({ sessionId: OTHER_SESSION_ID }) }, conflict))
            .rejects.toThrow('does not match replacement');
        await backend.saveSessionManifest(OTHER_SESSION_ID, testSession({ sessionId: OTHER_SESSION_ID }));
        await expect(replaceSessionWithPortableBundle(backend, source, conflict, { randomUUID: () => OTHER_SESSION_ID }))
            .rejects.toThrow(`Staging session ${OTHER_SESSION_ID} is already registered`);

        const unregistered = { sessionId: STAGING_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceSessionWithPortableBundle(backend, { ...source, session: testSession({ sessionId: STAGING_ID }) }, unregistered))
            .rejects.toThrow('is no longer registered');
    });

    it('restores the old session when the replacement fails after the target changed', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession({ name: 'Old' }));
        await backend.saveScript(TEST_SESSION_ID, '01_old.sql', 'SELECT 0');
        const write = backend.writePortableSessionBundle.bind(backend);
        let targetWrites = 0;
        vi.spyOn(backend, 'writePortableSessionBundle').mockImplementation(async (bundle, sessionId, fresh) => {
            // Fail the first write of the new bundle into the target, not the restore of the old one
            if (sessionId === TEST_SESSION_ID && targetWrites++ === 0) throw new Error('quota exceeded');
            return await write(bundle, sessionId, fresh);
        });
        const source = { session: testSession({ name: 'New' }), catalogs: [], scripts: [{ name: '01_new.sql', sql: 'SELECT 1' }] };
        await expect(replaceSessionWithPortableBundle(backend, source, {
            sessionId: TEST_SESSION_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => STAGING_ID })).rejects.toThrow('quota exceeded');

        expect((await backend.loadSession(TEST_SESSION_ID)).name).toBe('Old');
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '01_old.sql', sql: 'SELECT 0' }]);
        expect(registry.manifest).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.OPFS }]);
        expect(await findSessionImportConflict(backend, STAGING_ID)).toBeNull();
        expect(registry.scripts.has(STAGING_ID)).toBe(false);
    });

    it('reports a failing staging cleanup of a successful replacement', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        vi.spyOn(backend, 'deletePortableSession').mockRejectedValue(new Error('locked'));
        const source = { session: testSession({ name: 'New' }), catalogs: [], scripts: [] };
        await expect(replaceSessionWithPortableBundle(backend, source, {
            sessionId: TEST_SESSION_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => STAGING_ID })).rejects.toThrow('locked');
    });

    it('restores the manifest entry when the replacement by a native folder fails', async () => {
        await backend.saveSessionManifest(TEST_SESSION_ID, testSession());
        await backend.saveScript(TEST_SESSION_ID, '01_query.sql', 'SELECT 1');
        const prepared = await nativeFolder('/tmp/selected');
        vi.spyOn(backend, 'deletePortableSessionFiles').mockRejectedValue(new Error('locked'));
        const conflict = { sessionId: TEST_SESSION_ID, location: { type: StorageBackendType.OPFS } } as const;
        await expect(replaceSessionWithNativeFolder(backend, prepared, conflict)).rejects.toThrow('locked');
        expect(registry.manifest).toEqual([{ path: TEST_SESSION_ID, storageType: StorageBackendType.OPFS }]);
        expect(await backend.loadScripts(TEST_SESSION_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });
});
