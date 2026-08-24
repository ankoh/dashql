import { describe, it, expect, vi, beforeEach } from 'vitest';
import { destroyRestoredNotebook, restoreAppState, restoreSingleNotebook } from './app_state_loader.js';
import { type StorageBackend, type NotebookData, type ScriptFolderData, StorageBackendType } from './storage_backend.js';
import type { DashQL } from '../../../core/api.js';
import { Logger } from '../../../platform/logger/logger.js';
import { ConnectorType } from '../connections/connector_info.js';

// Notebook identity is the bare UUID, used as both the manifest entry path and the notebook's own
// `notebookId`. The loader gates on UUID validity, so fixtures must use real UUIDs.
const HYPER_ID = 'a0000000-0000-4000-8000-000000000001';
const DEMO_ID = 'a0000000-0000-4000-8000-000000000002';
const DATALESS_ID = 'a0000000-0000-4000-8000-000000000003';
const GOOD_ID = 'a0000000-0000-4000-8000-000000000004';
const BAD_ID = 'a0000000-0000-4000-8000-000000000005';
const UNCONFIGURED_ID = 'a0000000-0000-4000-8000-000000000006';
const UNKNOWN_CONNECTOR_ID = 'a0000000-0000-4000-8000-000000000007';
const NO_PARAMS_ID = 'a0000000-0000-4000-8000-000000000008';
const NO_ID_PATH = 'a0000000-0000-4000-8000-000000000009';
const THROWING_ID = 'a0000000-0000-4000-8000-00000000000a';
const NO_SCHEMA_ID = 'a0000000-0000-4000-8000-00000000000b';
const SCHEMA_ID = 'a0000000-0000-4000-8000-00000000000c';
const CATALOG_FAIL_ID = 'a0000000-0000-4000-8000-00000000000d';
const MULTI_PAGE_ID = 'a0000000-0000-4000-8000-00000000000e';
const EMPTY_NOTEBOOK_ID = 'a0000000-0000-4000-8000-00000000000f';
const NOTEBOOK_FAIL_ID = 'a0000000-0000-4000-8000-000000000010';
const SF_ID = 'a0000000-0000-4000-8000-000000000011';
const TRINO_ID = 'a0000000-0000-4000-8000-000000000012';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

describe('restoreAppState', () => {
    let mockBackend: StorageBackend;
    let mockCore: DashQL;
    let logger: Logger;
    let progressUpdates: any[];

    beforeEach(() => {
        progressUpdates = [];

        mockBackend = {
            getBackendType: vi.fn(() => StorageBackendType.OPFS),
            listNotebooks: vi.fn(),
            loadNotebook: vi.fn(),
            saveNotebookManifest: vi.fn(),
            deleteNotebook: vi.fn(),
            loadNotebookSchema: vi.fn(),
            saveNotebookSchema: vi.fn(),
            loadNotebookFunctions: vi.fn().mockResolvedValue(null),
            saveNotebookFunctions: vi.fn(),
            loadScriptFolders: vi.fn(),
            createScriptFolder: vi.fn(),
            deleteScriptFolder: vi.fn(),
            renameScriptFolder: vi.fn(),
            loadScript: vi.fn(),
            saveScript: vi.fn(),
            deleteScript: vi.fn(),
            renameScript: vi.fn(),
            loadScriptDraft: vi.fn(),
            saveScriptDraft: vi.fn(),
            loadQueryResultCache: vi.fn().mockResolvedValue(null),
            saveQueryResultCache: vi.fn(),
            listQueryResultCache: vi.fn(async () => []),
            hasCachedQueryResult: vi.fn(),
            touchQueryResultCacheAccess: vi.fn(),
            deleteQueryResultCache: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };

        // Mock DashQL WASM instance. Connection-owned catalog scripts still use DashQLScript;
        // notebook-owned documents use DashQLEditorSession.
        let scriptIdCounter = 0;
        mockCore = {
            createCatalog: vi.fn(() => ({
                dropScript: vi.fn(),
                loadScript: vi.fn(),
                destroy: vi.fn(),
            })),
            createEditorSession: vi.fn(() => {
                let text = '';
                let documentRevision = 0n;
                const editorSession = {
                    getCatalogEntryId: vi.fn(() => ++scriptIdCounter),
                    getDocumentRevision: vi.fn(() => documentRevision),
                    replaceText: vi.fn((_revision: bigint, nextText: string) => {
                        text = nextText;
                        documentRevision += 1n;
                        return { status: 0 };
                    }),
                    getText: vi.fn(() => text),
                    ensureAnalysis: vi.fn(),
                    getParsed: vi.fn(() => null),
                    getAnalyzed: vi.fn(() => null),
                    getStatistics: vi.fn(() => null),
                    setCursor: vi.fn(),
                    getCursor: vi.fn(() => null),
                    loadIntoCatalog: vi.fn(),
                    dropFromCatalog: vi.fn(),
                    destroy: vi.fn(),
                };
                return editorSession;
            }),
            createScript: vi.fn(() => ({
                replaceText: vi.fn(),
                analyze: vi.fn(),
                toString: vi.fn(() => ''),
                getParsed: vi.fn(() => null),
                destroy: vi.fn(),
            })),
        } as any;

        logger = new NullLogger();
    });

    it('returns empty state when manifest is empty', async () => {
        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([]);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        expect(result.notebookScripts.size).toBe(0);
        expect(progressUpdates.length).toBeGreaterThan(0);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.total).toBe(0);
        expect(finalProgress.restoreCatalogs.total).toBe(0);
        expect(finalProgress.restoreNotebookScripts.total).toBe(0);
    });

    it('restores a single HYPER notebook correctly', async () => {
        const notebookEntry = { path: HYPER_ID };
        const notebookData: NotebookData = {
            notebookId: HYPER_ID,
            notebookPath: HYPER_ID,
            name: 'Test Notebook',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            }
        };

        const pages: ScriptFolderData[] = [
            {
                name: 'page-1',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 1;' },
                    { name: '02-script.sql', sql: 'SELECT 2;' }
                ]
            }
        ];

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue('CREATE TABLE test (id INT);');
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue('-- draft');

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(1);
        const connectionId = result.connectionByNotebook.get(HYPER_ID)!;
        expect(result.connectionStates.has(connectionId)).toBe(true);
        expect(result.notebookScripts.size).toBe(1);
        expect(result.notebookScripts.has(HYPER_ID)).toBe(true);

        const connection = result.connectionStates.get(connectionId)!;
        expect(connection.notebookId).toBe(HYPER_ID);
        expect(connection.connectorInfo.connectorType).toBe(ConnectorType.HYPER);

        // Verify connection is in correct type index
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain(connectionId);

        const notebookScripts = result.notebookScripts.get(HYPER_ID)!;
        expect(notebookScripts.notebookId).toBe(HYPER_ID);
        expect(Object.keys(notebookScripts.scriptFolders).length).toBe(1);

        // Verify progress tracking
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(1);
        expect(finalProgress.restoreNotebookScripts.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('rejects legacy dataless notebooks', async () => {
        const demoNotebook = { path: DEMO_ID };
        const datalessNotebook = { path: DATALESS_ID };

        const demoData: NotebookData = {
            notebookId: DEMO_ID,
            notebookPath: DEMO_ID,
            name: 'Demo',
            connectionParams: { dataless: { demoConnector: true } } as any,
            metadata: { originalFileName: 'demo.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const datalessData: NotebookData = {
            notebookId: DATALESS_ID,
            notebookPath: DATALESS_ID,
            name: 'Dataless',
            connectionParams: { dataless: {} } as any,
            metadata: { originalFileName: 'dataless.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([demoNotebook, datalessNotebook]);
        vi.mocked(mockBackend.loadNotebook).mockImplementation(async (path) => {
            if (path === DEMO_ID) return demoData;
            if (path === DATALESS_ID) return datalessData;
            throw new Error('Unknown notebook');
        });
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        expect(result.notebookScripts.size).toBe(0);
        expect(result.invalidNotebooks.get(DEMO_ID)?.error).toBe('unknown_connector');
        expect(result.invalidNotebooks.get(DATALESS_ID)?.error).toBe('unknown_connector');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.skipped).toBe(2);
    });

    it('handles corrupted notebook gracefully', async () => {
        const goodNotebook = { path: GOOD_ID };
        const badNotebook = { path: BAD_ID };

        const goodData: NotebookData = {
            notebookId: GOOD_ID,
            notebookPath: GOOD_ID,
            name: 'Good',
            connectionParams: { duckdb: {} },
            metadata: { originalFileName: 'good.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([goodNotebook, badNotebook]);
        vi.mocked(mockBackend.loadNotebook).mockImplementation(async (path) => {
            if (path === GOOD_ID) return goodData;
            throw new Error('Notebook corrupted');
        });
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // A good notebook should be restored; a notebook whose files can't be read is surfaced
        // as invalid (blocked + deletable in the selector), not left as a silent restore failure.
        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has(result.connectionByNotebook.get(GOOD_ID)!)).toBe(true);
        expect(result.invalidNotebooks.get(BAD_ID)?.error).toBe('notebook_unreadable');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1); // unreadable notebook
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
    });

    it('restores notebooks without setupParams (inactive connections are never written, but handle gracefully)', async () => {
        const notebookEntry = { path: UNCONFIGURED_ID };
        const notebookData: NotebookData = {
            notebookId: UNCONFIGURED_ID,
            notebookPath: UNCONFIGURED_ID,
            name: 'Unconfigured',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    // setupParams is missing — normally inactive connections are never
                    // written to storage, but if one is found it should restore fine
                } as any
            },
            metadata: { originalFileName: 'unconfigured.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Should restore even without setupParams
        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has(result.connectionByNotebook.get(UNCONFIGURED_ID)!)).toBe(true);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('marks a notebook whose manifest entry path is not a valid UUID as invalid (skipped, not failed)', async () => {
        // The first gate rejects a bad routing key before any loadNotebook call.
        const notebookEntry = { path: 'imported-1700000000000' };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Never attempted a load — surfaced as invalid, keyed by the raw manifest path.
        expect(mockBackend.loadNotebook).not.toHaveBeenCalled();
        expect(result.connectionStates.size).toBe(0);
        const invalid = result.invalidNotebooks.get('imported-1700000000000')!;
        expect(invalid.error).toBe('invalid_notebook_id');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a notebook with an unknown connector as invalid (skipped, not failed)', async () => {
        const notebookEntry = { path: UNKNOWN_CONNECTOR_ID };
        const notebookData: NotebookData = {
            notebookId: UNKNOWN_CONNECTOR_ID,
            notebookPath: UNKNOWN_CONNECTOR_ID,
            name: 'Invalid',
            // Completely invalid format — matches no known connector
            connectionParams: { garbage: 'data' } as any,
            metadata: { originalFileName: 'invalid.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Refused a load: not in the connection map, surfaced as invalid instead.
        expect(result.connectionStates.size).toBe(0);
        expect(result.invalidNotebooks.size).toBe(1);
        const invalid = result.invalidNotebooks.get(UNKNOWN_CONNECTOR_ID)!;
        expect(invalid.notebookId).toBe(UNKNOWN_CONNECTOR_ID);
        expect(invalid.error).toBe('unknown_connector');

        // Accounted as skipped, not failed — nothing was attempted.
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a notebook with no connectionParams as invalid', async () => {
        const notebookEntry = { path: NO_PARAMS_ID };
        const notebookData = {
            notebookId: NO_PARAMS_ID,
            notebookPath: NO_PARAMS_ID,
            name: 'No Params',
            // connectionParams deliberately omitted
            metadata: { originalFileName: 'x.sql', createdAt: '2024-01-01T00:00:00Z' }
        } as any as NotebookData;

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        expect(result.invalidNotebooks.get(NO_PARAMS_ID)?.error).toBe('missing_connection_params');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a notebook with an empty notebookId as invalid (keyed by manifest path)', async () => {
        // The manifest entry path is a valid UUID (passes the first gate), but the loaded notebook
        // data has an empty notebookId, so validateNotebookData rejects it.
        const notebookEntry = { path: NO_ID_PATH };
        const notebookData = {
            notebookId: '',
            notebookPath: NO_ID_PATH,
            name: 'No Id',
            connectionParams: { duckdb: {} },
            metadata: { originalFileName: 'x.sql', createdAt: '2024-01-01T00:00:00Z' }
        } as any as NotebookData;

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        // Keyed by the manifest entry path (the authoritative registry/delete key).
        expect(result.invalidNotebooks.get(NO_ID_PATH)?.error).toBe('missing_notebook_id');
    });

    it('surfaces a notebook whose load throws as invalid (unreadable), keyed by manifest path', async () => {
        // A native notebook folder that was moved/deleted (or a corrupt OPFS notebook) makes loadNotebook
        // throw. Rather than a silent restore failure that logs on every launch with no way to remove
        // the stale entry, it must land in invalidNotebooks so the selector can show it deletable.
        const goodNotebook = { path: GOOD_ID };
        const throwingNotebook = { path: THROWING_ID };

        const goodData: NotebookData = {
            notebookId: GOOD_ID,
            notebookPath: GOOD_ID,
            name: 'Good',
            connectionParams: { duckdb: {} },
            metadata: { originalFileName: 'good.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([goodNotebook, throwingNotebook]);
        vi.mocked(mockBackend.loadNotebook).mockImplementation(async (path) => {
            if (path === GOOD_ID) return goodData;
            throw new Error('I/O error reading notebook');
        });
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // The throwing notebook is surfaced as invalid (skipped), not counted as a hard failure.
        expect(result.connectionStates.size).toBe(1);
        expect(result.invalidNotebooks.size).toBe(1);
        const invalid = result.invalidNotebooks.get(THROWING_ID)!;
        expect(invalid.error).toBe('notebook_unreadable');
        // Keyed by the manifest entry path — that is the registry/delete key, and the notebook data
        // was never readable to provide any other identity.
        expect(invalid.notebookId).toBe(THROWING_ID);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
    });

    it('handles missing catalog schema gracefully', async () => {
        const notebookEntry = { path: NO_SCHEMA_ID };
        const notebookData: NotebookData = {
            notebookId: NO_SCHEMA_ID,
            notebookPath: NO_SCHEMA_ID,
            name: 'No Schema',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null); // No schema
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(1);
        expect(result.notebookScripts.size).toBe(1);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreCatalogs.succeeded).toBe(1); // Should succeed even without schema
    });

    it('restores catalog schema correctly', async () => {
        const notebookEntry = { path: SCHEMA_ID };
        const notebookData: NotebookData = {
            notebookId: SCHEMA_ID,
            notebookPath: SCHEMA_ID,
            name: 'Schema Test',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const schemaSQL = 'CREATE TABLE users (id INT, name VARCHAR);';

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(schemaSQL);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const connection = result.connectionStates.get(result.connectionByNotebook.get(SCHEMA_ID)!)!;
        expect(connection.catalogUpdates.restoredAt).not.toBeNull();

        // Verify catalogRelationScript was updated with schema
        expect(connection.catalogRelationScript.replaceText).toHaveBeenCalledWith(schemaSQL);
        expect(connection.catalogRelationScript.analyze).toHaveBeenCalled();
        expect(connection.catalog.loadScript).toHaveBeenCalled();
    });

    it('restores catalog functions eagerly', async () => {
        const notebookEntry = { path: SCHEMA_ID };
        const notebookData: NotebookData = {
            notebookId: SCHEMA_ID,
            notebookPath: SCHEMA_ID,
            name: 'Functions Test',
            connectionParams: { duckdb: {} },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' },
        };
        const functionsSQL = 'CREATE FUNCTION answer() AS 42;';

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookFunctions).mockResolvedValue(functionsSQL);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(mockCore, mockBackend, logger, () => { });
        const connection = result.connectionStates.get(result.connectionByNotebook.get(SCHEMA_ID)!)!;

        expect(connection.catalogFunctionScript.replaceText).toHaveBeenCalledWith(functionsSQL);
        expect(connection.catalogFunctionScript.analyze).toHaveBeenCalled();
        expect(connection.catalog.loadScript).toHaveBeenCalledWith(
            connection.catalogFunctionScript,
            expect.any(Number),
        );
    });

    it('handles catalog restoration failure gracefully', async () => {
        const notebookEntry = { path: CATALOG_FAIL_ID };
        const notebookData: NotebookData = {
            notebookId: CATALOG_FAIL_ID,
            notebookPath: CATALOG_FAIL_ID,
            name: 'Catalog Fail',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockRejectedValue(new Error('Catalog error'));
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Connection should still be restored even if catalog fails
        expect(result.connectionStates.size).toBe(1);
        expect(result.notebookScripts.size).toBe(1);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreCatalogs.failed).toBe(1); // Catalog failed
        expect(finalProgress.restoreNotebookScripts.succeeded).toBe(1); // Notebook scripts still succeeded
    });

    it('restores notebooks with multiple pages and scripts', async () => {
        const notebookEntry = { path: MULTI_PAGE_ID };
        const notebookData: NotebookData = {
            notebookId: MULTI_PAGE_ID,
            notebookPath: MULTI_PAGE_ID,
            name: 'Multi Page',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const pages: ScriptFolderData[] = [
            {
                name: 'page-1',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 1;' },
                    { name: '02-script.sql', sql: 'SELECT 2;' }
                ]
            },
            {
                name: 'page-2',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 3;' }
                ]
            },
            {
                name: 'page-3',
                scripts: []
            }
        ];

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue('-- my draft');

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const notebookScripts = result.notebookScripts.get(MULTI_PAGE_ID)!;
        expect(Object.keys(notebookScripts.scriptFolders).length).toBe(3);
        expect(Object.keys(notebookScripts.scriptFolders['page-1'].scripts).length).toBe(2);
        expect(Object.keys(notebookScripts.scriptFolders['page-2'].scripts).length).toBe(1);
        expect(Object.keys(notebookScripts.scriptFolders['page-3'].scripts).length).toBe(0);

        // Verify draft script was loaded
        expect(notebookScripts.scripts[notebookScripts.uncommittedScriptId].editorSession.replaceText).toHaveBeenCalledWith(0n, '-- my draft');
        for (const scriptData of Object.values(notebookScripts.scripts)) {
            expect(scriptData.analysisOutdated).toBe(true);
            expect(scriptData.editorUpdate).toBeNull();
            expect(scriptData.editorSession.ensureAnalysis).not.toHaveBeenCalled();
        }
    });

    it('does not analyze ordinary persisted scripts while restoring a notebook', async () => {
        const notebookEntry = { path: MULTI_PAGE_ID };
        const notebookData: NotebookData = {
            notebookId: MULTI_PAGE_ID,
            notebookPath: MULTI_PAGE_ID,
            name: 'Invalid Script',
            connectionParams: { duckdb: {} },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([
            { name: 'page-1', scripts: [{ name: '01-script.sql', sql: 'invalid sql' }] }
        ]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.notebookScripts.has(MULTI_PAGE_ID)).toBe(true);
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreNotebookScripts.succeeded).toBe(1);
        const scripts = result.notebookScripts.get(MULTI_PAGE_ID)!;
        for (const scriptData of Object.values(scripts.scripts)) {
            expect(scriptData.analysisOutdated).toBe(true);
            expect(scriptData.editorSession.ensureAnalysis).not.toHaveBeenCalled();
        }
    });

    it('creates at least one empty page for notebooks with no pages', async () => {
        const notebookEntry = { path: EMPTY_NOTEBOOK_ID };
        const notebookData: NotebookData = {
            notebookId: EMPTY_NOTEBOOK_ID,
            notebookPath: EMPTY_NOTEBOOK_ID,
            name: 'Empty Notebook',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]); // No pages
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const notebookScripts = result.notebookScripts.get(EMPTY_NOTEBOOK_ID)!;
        const folders = Object.keys(notebookScripts.scriptFolders);
        expect(folders.length).toBe(1);
        expect(Object.keys(notebookScripts.scriptFolders[folders[0]].scripts).length).toBe(0);
    });

    it('handles notebook restoration failure without affecting connection', async () => {
        const notebookEntry = { path: NOTEBOOK_FAIL_ID };
        const notebookData: NotebookData = {
            notebookId: NOTEBOOK_FAIL_ID,
            notebookPath: NOTEBOOK_FAIL_ID,
            name: 'Notebook Fail',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([notebookEntry]);
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockRejectedValue(new Error('Notebook error'));

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Connection should be restored even if notebook fails
        expect(result.connectionStates.size).toBe(1);
        expect(result.notebookScripts.size).toBe(0); // Notebook failed

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreNotebookScripts.failed).toBe(1);
    });

    it('allocates incremental restores against the live signature map', async () => {
        const secondId = 'a0000000-0000-4000-8000-000000000013';
        vi.mocked(mockBackend.loadNotebook).mockImplementation(async (notebookId) => ({
            notebookId,
            name: 'Imported Notebook',
            connectionParams: { duckdb: {} },
            metadata: {},
        }));
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const liveSignatures = new Map<string, string | null>();
        const first = await restoreSingleNotebook(mockCore, mockBackend, logger, DATALESS_ID, liveSignatures);
        const second = await restoreSingleNotebook(mockCore, mockBackend, logger, secondId, liveSignatures);

        for (const scriptData of Object.values(first.notebookScripts.scripts)) {
            expect(scriptData.analysisOutdated).toBe(true);
            expect(scriptData.editorUpdate).toBeNull();
        }
        expect(first.connection.connectionSignature.signatures).toBe(liveSignatures);
        expect(second.connection.connectionSignature.signatures).toBe(liveSignatures);
        expect(second.connection.connectionSignature.signatureString)
            .not.toBe(first.connection.connectionSignature.signatureString);
        expect(liveSignatures.size).toBe(2);

        destroyRestoredNotebook(second);
        destroyRestoredNotebook(first);
        expect(liveSignatures.size).toBe(0);
    });

    it('rejects incremental restore when scripts cannot be loaded and frees runtime state', async () => {
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue({
            notebookId: NOTEBOOK_FAIL_ID,
            name: 'Notebook Fail',
            connectionParams: { duckdb: {} },
            metadata: {},
        });
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockRejectedValue(new Error('Notebook error'));

        const liveSignatures = new Map<string, string | null>();
        await expect(restoreSingleNotebook(
            mockCore,
            mockBackend,
            logger,
            NOTEBOOK_FAIL_ID,
            liveSignatures,
        )).rejects.toThrow(`imported notebook ${NOTEBOOK_FAIL_ID} did not restore its scripts`);

        expect(liveSignatures.size).toBe(0);
        const catalog = vi.mocked(mockCore.createCatalog).mock.results[0].value as any;
        expect(catalog.destroy).toHaveBeenCalledOnce();
    });

    it('releases the signature when connection construction fails', async () => {
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue({
            notebookId: DATALESS_ID,
            name: 'Broken Connection',
            connectionParams: { duckdb: {} },
            metadata: {},
        });
        vi.mocked(mockCore.createCatalog).mockImplementationOnce(() => {
            throw new Error('catalog allocation failed');
        });

        const liveSignatures = new Map<string, string | null>();
        await expect(restoreSingleNotebook(
            mockCore,
            mockBackend,
            logger,
            DATALESS_ID,
            liveSignatures,
        )).rejects.toThrow('catalog allocation failed');

        expect(liveSignatures.size).toBe(0);
    });

    it('restores multiple notebooks of different types', async () => {
        const hyperNotebook = { path: HYPER_ID };
        const salesforceNotebook = { path: SF_ID };
        const trinoNotebook = { path: TRINO_ID };

        const hyperData: NotebookData = {
            notebookId: HYPER_ID,
            notebookPath: HYPER_ID,
            name: 'Hyper',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            metadata: { originalFileName: 'hyper.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const salesforceData: NotebookData = {
            notebookId: SF_ID,
            notebookPath: SF_ID,
            name: 'Salesforce',
            connectionParams: {
                salesforce: {
                    setupTimings: {},
                    setupParams: {
                        instanceUrl: 'https://example.salesforce.com',
                        appConsumerKey: 'key',
                        appConsumerSecret: 'secret',
                        login: 'user@example.com'
                    }
                } as any
            },
            metadata: { originalFileName: 'sf.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const trinoData: NotebookData = {
            notebookId: TRINO_ID,
            notebookPath: TRINO_ID,
            name: 'Trino',
            connectionParams: {
                trino: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://trino:8080',
                        catalogName: 'hive',
                        auth: { authType: 'AUTH_BASIC' }
                    }
                } as any
            },
            metadata: { originalFileName: 'trino.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listNotebooks).mockResolvedValue([hyperNotebook, salesforceNotebook, trinoNotebook]);
        vi.mocked(mockBackend.loadNotebook).mockImplementation(async (path) => {
            if (path === HYPER_ID) return hyperData;
            if (path === SF_ID) return salesforceData;
            if (path === TRINO_ID) return trinoData;
            throw new Error('Unknown notebook');
        });
        vi.mocked(mockBackend.loadNotebookSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(3);
        expect(result.notebookScripts.size).toBe(3);

        // Verify type indices are populated correctly
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain(result.connectionByNotebook.get(HYPER_ID));
        expect(result.connectionStatesByType[ConnectorType.SALESFORCE_DATA_CLOUD]).toContain(result.connectionByNotebook.get(SF_ID));
        expect(result.connectionStatesByType[ConnectorType.TRINO]).toContain(result.connectionByNotebook.get(TRINO_ID));

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(3);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(3);
        expect(finalProgress.restoreNotebookScripts.succeeded).toBe(3);
    });
});
