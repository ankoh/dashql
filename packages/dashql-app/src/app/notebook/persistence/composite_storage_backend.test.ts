import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../platform/electron_fs.js', async () => ({
    ...(await import('./test_fs_mock.js')).makeFsMock(),
    ...(await import('./test_fs_mock.js')).makePathMock(),
}));

import { TestLogger } from '../../../platform/logger/test_logger.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import type { NotebookEntry, NotebookRegistryBackend } from './storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import { NotebookTestBackend, TEST_NOTEBOOK_ID, testNotebook } from './notebook_test_backend.js';
import { fsStore, makeFsMock, resetFsStore } from './test_fs_mock.js';
import { replaceNotebookWithPortableBundle } from './notebook_import_transaction.js';

class Registry extends NotebookTestBackend implements NotebookRegistryBackend {
    manifest: NotebookEntry[] = [];
    override async listNotebooks(): Promise<NotebookEntry[]> { return [...this.manifest]; }
    override async saveNotebookManifest(id: string, data: any): Promise<void> {
        await super.saveNotebookManifest(id, data);
        await this.upsertNotebookEntry({ path: id, storageType: StorageBackendType.OPFS });
    }
    async upsertNotebookEntry(entry: NotebookEntry): Promise<void> {
        const index = this.manifest.findIndex(value => value.path === entry.path);
        if (index < 0) this.manifest.push(entry); else this.manifest[index] = entry;
    }
    async removeNotebookEntry(id: string): Promise<void> { this.manifest = this.manifest.filter(entry => entry.path !== id); }
    async reorderNotebooks(ids: string[]): Promise<void> {
        const byId = new Map(this.manifest.map(entry => [entry.path, entry]));
        this.manifest = ids.flatMap(id => byId.get(id) ?? []).concat(this.manifest.filter(entry => !ids.includes(entry.path)));
    }
    async deleteNotebookFiles(id: string): Promise<void> { await super.deleteNotebook(id); }
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

    it('routes unknown and OPFS notebooks to the registry backend', async () => {
        await backend.saveNotebookManifest(TEST_NOTEBOOK_ID, testNotebook());
        await backend.saveScript(TEST_NOTEBOOK_ID, '01_query.sql', 'SELECT 1');
        expect(await backend.loadScripts(TEST_NOTEBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        expect(registry.manifest).toEqual([{ path: TEST_NOTEBOOK_ID, storageType: StorageBackendType.OPFS }]);
        expect(fsStore.files.size).toBe(0);
    });

    it('routes flat CRUD to a registered native directory and preserves files on unregister', async () => {
        const dir = '/tmp/native-v2';
        await backend.upsertNotebookEntry({ path: TEST_NOTEBOOK_ID, storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveNotebookManifest(TEST_NOTEBOOK_ID, { ...testNotebook(), storageType: StorageBackendType.Native, nativePath: dir });
        await backend.saveScript(TEST_NOTEBOOK_ID, '01_query.sql', 'SELECT 1');
        await backend.renameScript(TEST_NOTEBOOK_ID, '01_query.sql', '02_renamed.sql');
        expect(await backend.loadScripts(TEST_NOTEBOOK_ID)).toEqual([{ name: '02_renamed.sql', sql: 'SELECT 1' }]);
        expect(fsStore.files.get(`${dir}/scripts/02_renamed.sql`)).toBe('SELECT 1');
        const before = new Map(fsStore.files);
        await backend.deleteNotebook(TEST_NOTEBOOK_ID);
        expect(registry.manifest).toEqual([]);
        expect(fsStore.files).toEqual(before);
    });

    it('replaces a persisted V1 notebook with V2 content under the same stable UUID', async () => {
        await registry.saveNotebookManifest(TEST_NOTEBOOK_ID, {
            ...testNotebook(),
            formatVersion: 1,
        } as any);
        await registry.saveScript(TEST_NOTEBOOK_ID, 'legacy.sql', 'SELECT 0');
        await backend.refreshLocations();

        const source = {
            notebook: testNotebook(),
            schemaSql: null,
            functionsSql: null,
            scripts: [{ name: '01_query.sql', sql: 'SELECT 1' }],
        };
        await replaceNotebookWithPortableBundle(backend, source, {
            notebookId: TEST_NOTEBOOK_ID,
            location: { type: StorageBackendType.OPFS },
        }, { randomUUID: () => '99999999-8888-4777-8666-555555555555' });

        expect(await backend.loadNotebook(TEST_NOTEBOOK_ID)).toEqual(testNotebook());
        expect(await backend.loadScripts(TEST_NOTEBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });
});
