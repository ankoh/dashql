import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restoreAppState } from './app_state_loader.js';
import { type StorageBackend, type SessionData, type PageData, StorageBackendType } from './storage_backend.js';
import type { DashQL } from '../../core/api.js';
import { Logger } from '../logger/logger.js';
import { ConnectorType } from '../../connection/connector_info.js';

// Session identity is the bare UUID, used as both the manifest entry path and the session's own
// `sessionId`. The loader gates on UUID validity, so fixtures must use real UUIDs.
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
            listSessions: vi.fn(),
            loadSession: vi.fn(),
            saveSessionManifest: vi.fn(),
            deleteSession: vi.fn(),
            loadSessionSchema: vi.fn(),
            saveSessionSchema: vi.fn(),
            loadSessionFunctions: vi.fn().mockResolvedValue(null),
            saveSessionFunctions: vi.fn(),
            loadNotebookPages: vi.fn(),
            createNotebookPage: vi.fn(),
            deleteNotebookPage: vi.fn(),
            renameNotebookPage: vi.fn(),
            loadNotebookScript: vi.fn(),
            saveNotebookScript: vi.fn(),
            deleteNotebookScript: vi.fn(),
            renameNotebookScript: vi.fn(),
            loadNotebookScriptDraft: vi.fn(),
            saveNotebookScriptDraft: vi.fn(),
            loadQueryResultCache: vi.fn().mockResolvedValue(null),
            saveQueryResultCache: vi.fn(),
            deleteQueryResultCache: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };

        // Mock DashQL WASM instance
        let scriptIdCounter = 0;
        mockCore = {
            createCatalog: vi.fn(() => ({
                dropScript: vi.fn(),
                loadScript: vi.fn(),
            })),
            createScript: vi.fn(() => ({
                getCatalogEntryId: vi.fn(() => ++scriptIdCounter),
                replaceText: vi.fn(),
                analyze: vi.fn(),
                toString: vi.fn(() => ''),
                // Methods exercised by Phase 4 eager analysis (analyzeNotebookScript):
                setNotebookPath: vi.fn(),
                getParsed: vi.fn(() => null),
                getAnalyzed: vi.fn(() => null),
                getStatistics: vi.fn(() => null),
                moveCursor: vi.fn(() => null),
            })),
            createScriptRegistry: vi.fn(() => ({
                addScript: vi.fn(),
            })),
        } as any;

        logger = new NullLogger();
    });

    it('returns empty state when manifest is empty', async () => {
        vi.mocked(mockBackend.listSessions).mockResolvedValue([]);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        expect(result.notebooks.size).toBe(0);
        expect(progressUpdates.length).toBeGreaterThan(0);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.total).toBe(0);
        expect(finalProgress.restoreCatalogs.total).toBe(0);
        expect(finalProgress.restoreNotebooks.total).toBe(0);
    });

    it('restores a single HYPER session correctly', async () => {
        const sessionEntry = { path: HYPER_ID };
        const sessionData: SessionData = {
            sessionId: HYPER_ID,
            sessionPath: HYPER_ID,
            name: 'Test Session',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    setupParams: {
                        endpoint: 'http://localhost:5432',
                        tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' }
                    }
                } as any
            },
            notebook: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            }
        };

        const pages: PageData[] = [
            {
                name: 'page-1',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 1;' },
                    { name: '02-script.sql', sql: 'SELECT 2;' }
                ]
            }
        ];

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue('CREATE TABLE test (id INT);');
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue('-- draft');

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has(HYPER_ID)).toBe(true);
        expect(result.notebooks.size).toBe(1);
        expect(result.notebooks.has(HYPER_ID)).toBe(true);

        const connection = result.connectionStates.get(HYPER_ID)!;
        expect(connection.sessionId).toBe(HYPER_ID);
        expect(connection.connectorInfo.connectorType).toBe(ConnectorType.HYPER);

        // Verify connection is in correct type index
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain(HYPER_ID);

        const notebook = result.notebooks.get(HYPER_ID)!;
        expect(notebook.sessionId).toBe(HYPER_ID);
        expect(Object.keys(notebook.notebookPages).length).toBe(1);

        // Verify progress tracking
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(1);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('restores both demo and regular DATALESS sessions', async () => {
        const demoSession = { path: DEMO_ID };
        const datalessSession = { path: DATALESS_ID };

        const demoData: SessionData = {
            sessionId: DEMO_ID,
            sessionPath: DEMO_ID,
            name: 'Demo',
            connectionParams: { dataless: { demoConnector: true } },
            notebook: { originalFileName: 'demo.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const datalessData: SessionData = {
            sessionId: DATALESS_ID,
            sessionPath: DATALESS_ID,
            name: 'Dataless',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'dataless.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([demoSession, datalessSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === DEMO_ID) return demoData;
            if (path === DATALESS_ID) return datalessData;
            throw new Error('Unknown session');
        });
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Both sessions should be restored
        expect(result.connectionStates.size).toBe(2);
        expect(result.connectionStates.has(DEMO_ID)).toBe(true);
        expect(result.connectionStates.has(DATALESS_ID)).toBe(true);
        expect(result.notebooks.size).toBe(2);

        // Verify both DATALESS connections are in correct type index
        expect(result.connectionStatesByType[ConnectorType.DATALESS]).toContain(DEMO_ID);
        expect(result.connectionStatesByType[ConnectorType.DATALESS]).toContain(DATALESS_ID);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(2);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(2);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(2);
    });

    it('handles corrupted session gracefully', async () => {
        const goodSession = { path: GOOD_ID };
        const badSession = { path: BAD_ID };

        const goodData: SessionData = {
            sessionId: GOOD_ID,
            sessionPath: GOOD_ID,
            name: 'Good',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'good.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([goodSession, badSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === GOOD_ID) return goodData;
            throw new Error('Session corrupted');
        });
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Good DATALESS session should be restored; a session whose files can't be read is surfaced
        // as invalid (blocked + deletable in the selector), not left as a silent restore failure.
        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has(GOOD_ID)).toBe(true);
        expect(result.invalidSessions.get(BAD_ID)?.error).toBe('session_unreadable');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1); // unreadable session
        expect(finalProgress.restoreConnections.succeeded).toBe(1); // good DATALESS session restored
    });

    it('restores sessions without setupParams (inactive connections are never written, but handle gracefully)', async () => {
        const sessionEntry = { path: UNCONFIGURED_ID };
        const sessionData: SessionData = {
            sessionId: UNCONFIGURED_ID,
            sessionPath: UNCONFIGURED_ID,
            name: 'Unconfigured',
            connectionParams: {
                hyper: {
                    setupTimings: {},
                    // setupParams is missing — normally inactive connections are never
                    // written to storage, but if one is found it should restore fine
                } as any
            },
            notebook: { originalFileName: 'unconfigured.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Should restore even without setupParams
        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has(UNCONFIGURED_ID)).toBe(true);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('marks a session whose manifest entry path is not a valid UUID as invalid (skipped, not failed)', async () => {
        // The first gate rejects a bad routing key before any loadSession call.
        const sessionEntry = { path: 'imported-1700000000000' };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Never attempted a load — surfaced as invalid, keyed by the raw manifest path.
        expect(mockBackend.loadSession).not.toHaveBeenCalled();
        expect(result.connectionStates.size).toBe(0);
        const invalid = result.invalidSessions.get('imported-1700000000000')!;
        expect(invalid.error).toBe('invalid_session_id');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a session with an unknown connector as invalid (skipped, not failed)', async () => {
        const sessionEntry = { path: UNKNOWN_CONNECTOR_ID };
        const sessionData: SessionData = {
            sessionId: UNKNOWN_CONNECTOR_ID,
            sessionPath: UNKNOWN_CONNECTOR_ID,
            name: 'Invalid',
            // Completely invalid format — matches no known connector
            connectionParams: { garbage: 'data' } as any,
            notebook: { originalFileName: 'invalid.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Refused a load: not in the connection map, surfaced as invalid instead.
        expect(result.connectionStates.size).toBe(0);
        expect(result.invalidSessions.size).toBe(1);
        const invalid = result.invalidSessions.get(UNKNOWN_CONNECTOR_ID)!;
        expect(invalid.sessionId).toBe(UNKNOWN_CONNECTOR_ID);
        expect(invalid.error).toBe('unknown_connector');

        // Accounted as skipped, not failed — nothing was attempted.
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a session with no connectionParams as invalid', async () => {
        const sessionEntry = { path: NO_PARAMS_ID };
        const sessionData = {
            sessionId: NO_PARAMS_ID,
            sessionPath: NO_PARAMS_ID,
            name: 'No Params',
            // connectionParams deliberately omitted
            notebook: { originalFileName: 'x.sql', createdAt: '2024-01-01T00:00:00Z' }
        } as any as SessionData;

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        expect(result.invalidSessions.get(NO_PARAMS_ID)?.error).toBe('missing_connection_params');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
    });

    it('marks a session with an empty sessionId as invalid (keyed by manifest path)', async () => {
        // The manifest entry path is a valid UUID (passes the first gate), but the loaded session
        // data has an empty sessionId, so validateSessionData rejects it.
        const sessionEntry = { path: NO_ID_PATH };
        const sessionData = {
            sessionId: '',
            sessionPath: NO_ID_PATH,
            name: 'No Id',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'x.sql', createdAt: '2024-01-01T00:00:00Z' }
        } as any as SessionData;

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(0);
        // Keyed by the manifest entry path (the authoritative registry/delete key).
        expect(result.invalidSessions.get(NO_ID_PATH)?.error).toBe('missing_session_id');
    });

    it('surfaces a session whose load throws as invalid (unreadable), keyed by manifest path', async () => {
        // A native session folder that was moved/deleted (or a corrupt OPFS session) makes loadSession
        // throw. Rather than a silent restore failure that logs on every launch with no way to remove
        // the stale entry, it must land in invalidSessions so the selector can show it deletable.
        const goodSession = { path: GOOD_ID };
        const throwingSession = { path: THROWING_ID };

        const goodData: SessionData = {
            sessionId: GOOD_ID,
            sessionPath: GOOD_ID,
            name: 'Good',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'good.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([goodSession, throwingSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === GOOD_ID) return goodData;
            throw new Error('I/O error reading session');
        });
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // The throwing session is surfaced as invalid (skipped), not counted as a hard failure.
        expect(result.connectionStates.size).toBe(1);
        expect(result.invalidSessions.size).toBe(1);
        const invalid = result.invalidSessions.get(THROWING_ID)!;
        expect(invalid.error).toBe('session_unreadable');
        // Keyed by the manifest entry path — that is the registry/delete key, and the session data
        // was never readable to provide any other identity.
        expect(invalid.sessionId).toBe(THROWING_ID);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(0);
        expect(finalProgress.restoreConnections.skipped).toBe(1);
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
    });

    it('handles missing catalog schema gracefully', async () => {
        const sessionEntry = { path: NO_SCHEMA_ID };
        const sessionData: SessionData = {
            sessionId: NO_SCHEMA_ID,
            sessionPath: NO_SCHEMA_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null); // No schema
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(1);
        expect(result.notebooks.size).toBe(1);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreCatalogs.succeeded).toBe(1); // Should succeed even without schema
    });

    it('restores catalog schema correctly', async () => {
        const sessionEntry = { path: SCHEMA_ID };
        const sessionData: SessionData = {
            sessionId: SCHEMA_ID,
            sessionPath: SCHEMA_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const schemaSQL = 'CREATE TABLE users (id INT, name VARCHAR);';

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(schemaSQL);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const connection = result.connectionStates.get(SCHEMA_ID)!;
        expect(connection.catalogUpdates.restoredAt).not.toBeNull();

        // Verify catalogRelationScript was updated with schema
        expect(connection.catalogRelationScript.replaceText).toHaveBeenCalledWith(schemaSQL);
        expect(connection.catalogRelationScript.analyze).toHaveBeenCalled();
        expect(connection.catalog.loadScript).toHaveBeenCalled();
    });

    it('handles catalog restoration failure gracefully', async () => {
        const sessionEntry = { path: CATALOG_FAIL_ID };
        const sessionData: SessionData = {
            sessionId: CATALOG_FAIL_ID,
            sessionPath: CATALOG_FAIL_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockRejectedValue(new Error('Catalog error'));
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Connection should still be restored even if catalog fails
        expect(result.connectionStates.size).toBe(1);
        expect(result.notebooks.size).toBe(1);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreCatalogs.failed).toBe(1); // Catalog failed
        expect(finalProgress.restoreNotebooks.succeeded).toBe(1); // Notebook still succeeded
    });

    it('restores notebooks with multiple pages and scripts', async () => {
        const sessionEntry = { path: MULTI_PAGE_ID };
        const sessionData: SessionData = {
            sessionId: MULTI_PAGE_ID,
            sessionPath: MULTI_PAGE_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const pages: PageData[] = [
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

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue('-- my draft');

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const notebook = result.notebooks.get(MULTI_PAGE_ID)!;
        expect(Object.keys(notebook.notebookPages).length).toBe(3);
        expect(Object.keys(notebook.notebookPages['page-1'].scripts).length).toBe(2);
        expect(Object.keys(notebook.notebookPages['page-2'].scripts).length).toBe(1);
        expect(Object.keys(notebook.notebookPages['page-3'].scripts).length).toBe(0);

        // Verify draft script was loaded
        expect(notebook.scripts[notebook.uncommittedScriptId].script.replaceText).toHaveBeenCalledWith('-- my draft');
    });

    it('creates at least one empty page for notebooks with no pages', async () => {
        const sessionEntry = { path: EMPTY_NOTEBOOK_ID };
        const sessionData: SessionData = {
            sessionId: EMPTY_NOTEBOOK_ID,
            sessionPath: EMPTY_NOTEBOOK_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]); // No pages
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        const notebook = result.notebooks.get(EMPTY_NOTEBOOK_ID)!;
        const folders = Object.keys(notebook.notebookPages);
        expect(folders.length).toBe(1);
        expect(Object.keys(notebook.notebookPages[folders[0]].scripts).length).toBe(0);
    });

    it('handles notebook restoration failure without affecting connection', async () => {
        const sessionEntry = { path: NOTEBOOK_FAIL_ID };
        const sessionData: SessionData = {
            sessionId: NOTEBOOK_FAIL_ID,
            sessionPath: NOTEBOOK_FAIL_ID,
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
            notebook: { originalFileName: 'test.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([sessionEntry]);
        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockRejectedValue(new Error('Notebook error'));

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        // Connection should be restored even if notebook fails
        expect(result.connectionStates.size).toBe(1);
        expect(result.notebooks.size).toBe(0); // Notebook failed

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreNotebooks.failed).toBe(1);
    });

    it('restores multiple sessions of different types', async () => {
        const hyperSession = { path: HYPER_ID };
        const salesforceSession = { path: SF_ID };
        const trinoSession = { path: TRINO_ID };

        const hyperData: SessionData = {
            sessionId: HYPER_ID,
            sessionPath: HYPER_ID,
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
            notebook: { originalFileName: 'hyper.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const salesforceData: SessionData = {
            sessionId: SF_ID,
            sessionPath: SF_ID,
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
            notebook: { originalFileName: 'sf.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const trinoData: SessionData = {
            sessionId: TRINO_ID,
            sessionPath: TRINO_ID,
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
            notebook: { originalFileName: 'trino.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([hyperSession, salesforceSession, trinoSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === HYPER_ID) return hyperData;
            if (path === SF_ID) return salesforceData;
            if (path === TRINO_ID) return trinoData;
            throw new Error('Unknown session');
        });
        vi.mocked(mockBackend.loadSessionSchema).mockResolvedValue(null);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const result = await restoreAppState(
            mockCore,
            mockBackend,
            logger,
            (progress) => progressUpdates.push(progress)
        );

        expect(result.connectionStates.size).toBe(3);
        expect(result.notebooks.size).toBe(3);

        // Verify type indices are populated correctly
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain(HYPER_ID);
        expect(result.connectionStatesByType[ConnectorType.SALESFORCE_DATA_CLOUD]).toContain(SF_ID);
        expect(result.connectionStatesByType[ConnectorType.TRINO]).toContain(TRINO_ID);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(3);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(3);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(3);
    });
});
