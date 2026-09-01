import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashQL } from '../../../core/api.js';
import { Logger } from '../../../platform/logger/logger.js';
import { ConnectorType } from '../connections/connector_info.js';
import { restoreAppState } from './app_state_loader.js';
import type { StorageBackend } from './storage_backend.js';
import { StorageBackendType } from './storage_backend.js';
import { TEST_DATABASE_ID, TEST_NOTEBOOK_ID, testNotebook } from './notebook_test_backend.js';

class NullLogger extends Logger {
    public destroy(): void {}
    protected flushPendingRecords(): void {}
}

describe('V2 app state loader', () => {
    let backend: StorageBackend;
    let core: DashQL;

    beforeEach(() => {
        let scriptId = 0;
        core = {
            createCatalog: vi.fn(() => ({ loadScripts: vi.fn(), destroy: vi.fn() })),
            createScript: vi.fn(() => ({
                replaceText: vi.fn(), analyzeAsync: vi.fn(async () => {}), destroy: vi.fn(),
            })),
            createScriptSession: vi.fn(() => {
                let text = '';
                let revision = 0n;
                return {
                    getCatalogEntryId: () => ++scriptId,
                    getDocumentRevision: () => revision,
                    replaceText: (_revision: bigint, next: string) => { text = next; revision += 1n; return { status: 0 }; },
                    getText: () => text,
                    destroy: vi.fn(),
                };
            }),
        } as any;
        backend = {
            getBackendType: () => StorageBackendType.OPFS,
            listNotebooks: vi.fn(async () => [{ path: TEST_NOTEBOOK_ID }]),
            loadAppSettings: vi.fn(async () => null), saveAppSettings: vi.fn(),
            loadNotebook: vi.fn(async () => testNotebook()), saveNotebookManifest: vi.fn(), deleteNotebook: vi.fn(),
            ensureNotebookIndex: vi.fn(),
            loadNotebookSchema: vi.fn(async () => null), saveNotebookSchema: vi.fn(),
            loadNotebookFunctions: vi.fn(async () => null), saveNotebookFunctions: vi.fn(),
            loadScripts: vi.fn(async () => [
                { name: '10_last.sql', sql: 'SELECT 10' },
                { name: '2_first.sql', sql: 'SELECT 2' },
            ]),
            loadScript: vi.fn(), saveScript: vi.fn(), deleteScript: vi.fn(), renameScript: vi.fn(),
            loadQueryResultCache: vi.fn(async () => null), touchQueryResultCacheAccess: vi.fn(),
            saveQueryResultCache: vi.fn(), listQueryResultCache: vi.fn(async () => []),
            hasCachedQueryResult: vi.fn(async () => false), deleteQueryResultCache: vi.fn(),
        };
    });

    it('restores one attached database and flat scripts with natural initial focus', async () => {
        const result = await restoreAppState(core, backend, new NullLogger(), () => {});
        expect(result.attachedDatabasesByNotebook.get(TEST_NOTEBOOK_ID)).toEqual({
            mainDatabaseId: TEST_DATABASE_ID,
            attachedDatabaseIds: [],
        });
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toEqual([TEST_DATABASE_ID]);
        const scripts = result.notebookScripts.get(TEST_NOTEBOOK_ID)!;
        expect(Object.keys(scripts.scriptRefs)).toEqual(['10_last.sql', '2_first.sql']);
        expect(scripts.scriptFocus.fileName).toBe('2_first.sql');
        expect(scripts.scripts[scripts.scriptRefs['2_first.sql'].scriptId].scriptSession.getText()).toBe('SELECT 2');
        expect(backend.ensureNotebookIndex).toHaveBeenCalledWith(TEST_NOTEBOOK_ID);
    });

    it('restores local and remote databases and routes scripts to the explicit main catalog', async () => {
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        vi.mocked(backend.loadNotebook).mockResolvedValue(testNotebook({
            mainDatabase: { databaseId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any },
            attachedDatabases: [{ databaseId: TEST_DATABASE_ID, params: { hyper: { protocol: 'WASM' } } as any }],
        }));
        const result = await restoreAppState(core, backend, new NullLogger(), () => {});
        expect(result.attachedDatabasesByNotebook.get(TEST_NOTEBOOK_ID)).toEqual({
            mainDatabaseId: remoteId,
            attachedDatabaseIds: [TEST_DATABASE_ID],
        });
        expect(result.connectionStates.size).toBe(2);
        expect(result.notebookScripts.get(TEST_NOTEBOOK_ID)?.databaseId).toBe(remoteId);
    });

    it('keeps the local database as main when a remote is attached', async () => {
        const remoteId = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';
        vi.mocked(backend.loadNotebook).mockResolvedValue(testNotebook({
            mainDatabase: { databaseId: TEST_DATABASE_ID, params: { hyper: { protocol: 'WASM' } } as any },
            attachedDatabases: [{ databaseId: remoteId, params: { trino: { endpoint: 'https://trino.example' } } as any }],
        }));
        const result = await restoreAppState(core, backend, new NullLogger(), () => {});
        expect(result.notebookScripts.get(TEST_NOTEBOOK_ID)?.databaseId).toBe(TEST_DATABASE_ID);
    });

    it('strictly refuses V1 before connection, catalog, scripts, or index mutation', async () => {
        vi.mocked(backend.loadNotebook).mockResolvedValue({ ...testNotebook(), formatVersion: 1 } as any);
        const result = await restoreAppState(core, backend, new NullLogger(), () => {});
        expect(result.invalidNotebooks.get(TEST_NOTEBOOK_ID)?.error).toBe('unsupported_format_version');
        expect(result.connectionStates.size).toBe(0);
        expect(result.notebookScripts.size).toBe(0);
        expect(core.createCatalog).not.toHaveBeenCalled();
        expect(backend.loadScripts).not.toHaveBeenCalled();
        expect(backend.ensureNotebookIndex).not.toHaveBeenCalled();
    });

    it('surfaces an unreadable notebook without allowing it into live registries', async () => {
        vi.mocked(backend.loadNotebook).mockRejectedValue(new Error('missing files'));
        const result = await restoreAppState(core, backend, new NullLogger(), () => {});
        expect(result.invalidNotebooks.get(TEST_NOTEBOOK_ID)?.error).toBe('notebook_unreadable');
        expect(result.connectionStates.size).toBe(0);
        expect(result.notebookScripts.size).toBe(0);
    });
});
