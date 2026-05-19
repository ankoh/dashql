import { describe, it, expect, vi, beforeEach } from 'vitest';
import { restoreAppState } from './app_state_loader.js';
import type { StorageBackend, SessionData, PageData } from './storage_backend.js';
import type { DashQL } from '../../core/api.js';
import { Logger } from '../logger/logger.js';
import { ConnectorType } from '../../connection/connector_info.js';

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
            getSchemaPrefix: vi.fn(() => 'mock://'),
            constructSessionPath: vi.fn((sessionId: string) => `mock://sessions/${sessionId}`),
            parseSessionPath: vi.fn((sessionPath: string) => sessionPath.replace('mock://', '')),
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
            loadNotebookScript: vi.fn(),
            saveNotebookScript: vi.fn(),
            deleteNotebookScript: vi.fn(),
            reorderNotebookScript: vi.fn(),
            loadNotebookScriptDraft: vi.fn(),
            saveNotebookScriptDraft: vi.fn(),
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
        const sessionEntry = { path: 'test-session-1' };
        const sessionData: SessionData = {
            sessionId: 'uuid-1',
            sessionPath: 'test-session-1',
            title: 'Test Session',
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
        expect(result.connectionStates.has('uuid-1')).toBe(true);
        expect(result.notebooks.size).toBe(1);
        expect(result.notebooks.has('uuid-1')).toBe(true);

        const connection = result.connectionStates.get('uuid-1')!;
        expect(connection.sessionId).toBe('uuid-1');
        expect(connection.connectorInfo.connectorType).toBe(ConnectorType.HYPER);

        // Verify connection is in correct type index
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain('uuid-1');

        const notebook = result.notebooks.get('uuid-1')!;
        expect(notebook.sessionId).toBe('uuid-1');
        expect(notebook.notebookPages.length).toBe(1);

        // Verify progress tracking
        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(1);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('restores both demo and regular DATALESS sessions', async () => {
        const demoSession = { path: 'demo-session' };
        const datalessSession = { path: 'dataless-session' };

        const demoData: SessionData = {
            sessionId: 'demo-uuid',
            sessionPath: 'demo-session',
            title: 'Demo',
            connectionParams: { dataless: { demoConnector: true } },
            notebook: { originalFileName: 'demo.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        const datalessData: SessionData = {
            sessionId: 'dataless-uuid',
            sessionPath: 'dataless-session',
            title: 'Dataless',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'dataless.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([demoSession, datalessSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === 'demo-session') return demoData;
            if (path === 'dataless-session') return datalessData;
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
        expect(result.connectionStates.has('demo-uuid')).toBe(true);
        expect(result.connectionStates.has('dataless-uuid')).toBe(true);
        expect(result.notebooks.size).toBe(2);

        // Verify both DATALESS connections are in correct type index
        expect(result.connectionStatesByType[ConnectorType.DATALESS]).toContain('demo-uuid');
        expect(result.connectionStatesByType[ConnectorType.DATALESS]).toContain('dataless-uuid');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(2);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(2);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(2);
    });

    it('handles corrupted session gracefully', async () => {
        const goodSession = { path: 'good-session' };
        const badSession = { path: 'bad-session' };

        const goodData: SessionData = {
            sessionId: 'good-uuid',
            sessionPath: 'good-session',
            title: 'Good',
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'good.sql', createdAt: '2024-01-01T00:00:00Z' }
        };

        vi.mocked(mockBackend.listSessions).mockResolvedValue([goodSession, badSession]);
        vi.mocked(mockBackend.loadSession).mockImplementation(async (path) => {
            if (path === 'good-session') return goodData;
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

        // Good DATALESS session should be restored, bad session should fail
        expect(result.connectionStates.size).toBe(1);
        expect(result.connectionStates.has('good-uuid')).toBe(true);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(1); // bad session
        expect(finalProgress.restoreConnections.succeeded).toBe(1); // good DATALESS session restored
    });

    it('restores sessions without setupParams (inactive connections are never written, but handle gracefully)', async () => {
        const sessionEntry = { path: 'unconfigured-session' };
        const sessionData: SessionData = {
            sessionId: 'unconfigured-uuid',
            sessionPath: 'unconfigured-session',
            title: 'Unconfigured',
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
        expect(result.connectionStates.has('unconfigured-uuid')).toBe(true);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(1);
        expect(finalProgress.restoreConnections.failed).toBe(0);
    });

    it('handles completely invalid connectionParams', async () => {
        const sessionEntry = { path: 'invalid-session' };
        const sessionData: SessionData = {
            sessionId: 'invalid-uuid',
            sessionPath: 'invalid-session',
            title: 'Invalid',
            // Completely invalid format
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

        expect(result.connectionStates.size).toBe(0);

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.failed).toBe(1);
    });

    it('handles missing catalog schema gracefully', async () => {
        const sessionEntry = { path: 'no-schema-session' };
        const sessionData: SessionData = {
            sessionId: 'no-schema-uuid',
            sessionPath: 'no-schema-session',
            title: 'No Schema',
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
        const sessionEntry = { path: 'schema-session' };
        const sessionData: SessionData = {
            sessionId: 'schema-uuid',
            sessionPath: 'schema-session',
            title: 'Schema Test',
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

        const connection = result.connectionStates.get('schema-uuid')!;
        expect(connection.catalogUpdates.restoredAt).not.toBeNull();

        // Verify catalogRelationScript was updated with schema
        expect(connection.catalogRelationScript.replaceText).toHaveBeenCalledWith(schemaSQL);
        expect(connection.catalogRelationScript.analyze).toHaveBeenCalled();
        expect(connection.catalog.loadScript).toHaveBeenCalled();
    });

    it('handles catalog restoration failure gracefully', async () => {
        const sessionEntry = { path: 'catalog-fail-session' };
        const sessionData: SessionData = {
            sessionId: 'catalog-fail-uuid',
            sessionPath: 'catalog-fail-session',
            title: 'Catalog Fail',
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
        const sessionEntry = { path: 'multi-page-session' };
        const sessionData: SessionData = {
            sessionId: 'multi-page-uuid',
            sessionPath: 'multi-page-session',
            title: 'Multi Page',
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

        const notebook = result.notebooks.get('multi-page-uuid')!;
        expect(notebook.notebookPages.length).toBe(3);
        expect(notebook.notebookPages[0].scripts.length).toBe(2);
        expect(notebook.notebookPages[1].scripts.length).toBe(1);
        expect(notebook.notebookPages[2].scripts.length).toBe(0);

        // Verify draft script was loaded
        expect(notebook.scripts[notebook.uncommittedScriptId].script.replaceText).toHaveBeenCalledWith('-- my draft');
    });

    it('creates at least one empty page for notebooks with no pages', async () => {
        const sessionEntry = { path: 'empty-notebook-session' };
        const sessionData: SessionData = {
            sessionId: 'empty-notebook-uuid',
            sessionPath: 'empty-notebook-session',
            title: 'Empty Notebook',
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

        const notebook = result.notebooks.get('empty-notebook-uuid')!;
        expect(notebook.notebookPages.length).toBe(1);
        expect(notebook.notebookPages[0].scripts.length).toBe(0);
    });

    it('handles notebook restoration failure without affecting connection', async () => {
        const sessionEntry = { path: 'notebook-fail-session' };
        const sessionData: SessionData = {
            sessionId: 'notebook-fail-uuid',
            sessionPath: 'notebook-fail-session',
            title: 'Notebook Fail',
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
        const hyperSession = { path: 'hyper-session' };
        const salesforceSession = { path: 'salesforce-session' };
        const trinoSession = { path: 'trino-session' };

        const hyperData: SessionData = {
            sessionId: 'hyper-uuid',
            sessionPath: 'hyper-session',
            title: 'Hyper',
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
            sessionId: 'sf-uuid',
            sessionPath: 'salesforce-session',
            title: 'Salesforce',
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
            sessionId: 'trino-uuid',
            sessionPath: 'trino-session',
            title: 'Trino',
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
            if (path === 'hyper-session') return hyperData;
            if (path === 'salesforce-session') return salesforceData;
            if (path === 'trino-session') return trinoData;
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
        expect(result.connectionStatesByType[ConnectorType.HYPER]).toContain('hyper-uuid');
        expect(result.connectionStatesByType[ConnectorType.SALESFORCE_DATA_CLOUD]).toContain('sf-uuid');
        expect(result.connectionStatesByType[ConnectorType.TRINO]).toContain('trino-uuid');

        const finalProgress = progressUpdates[progressUpdates.length - 1];
        expect(finalProgress.restoreConnections.succeeded).toBe(3);
        expect(finalProgress.restoreCatalogs.succeeded).toBe(3);
        expect(finalProgress.restoreNotebooks.succeeded).toBe(3);
    });
});
