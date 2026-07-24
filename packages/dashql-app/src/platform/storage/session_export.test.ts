import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { exportSessionAsZip, exportSessionAsSharedZip } from './session_export.js';
import { type StorageBackend, type SessionData, type PageData, StorageBackendType } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

describe('exportSessionAsZip', () => {
    let mockBackend: StorageBackend;

    beforeEach(() => {
        mockBackend = {
            getBackendType: vi.fn(() => StorageBackendType.OPFS),
            listSessions: vi.fn(),
            loadSession: vi.fn(),
            saveSessionManifest: vi.fn(),
            deleteSession: vi.fn(),
            loadSessionSchema: vi.fn(),
            saveSessionSchema: vi.fn(),
            loadSessionFunctions: vi.fn(),
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
            listQueryResultCache: vi.fn(async () => []),
            touchQueryResultCacheAccess: vi.fn(),
            deleteQueryResultCache: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };
    });

    it('exports a session with metadata and notebook pages', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid-1',
            sessionPath: 'test-session',
            name: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            },
        };

        const pages: PageData[] = [
            {
                name: 'page-1',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 1;' },
                    { name: '02-script.sql', sql: 'SELECT 2;' },
                ],
            },
            {
                name: 'page-2',
                scripts: [
                    { name: '01-script.sql', sql: 'SELECT 3;' },
                ],
            },
        ];

        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportSessionAsZip('test-session', mockBackend);

        expect(mockBackend.loadSession).toHaveBeenCalledWith('test-session');
        expect(mockBackend.loadNotebookPages).toHaveBeenCalledWith('test-session');
        expect(mockBackend.loadNotebookScriptDraft).toHaveBeenCalledWith('test-session');

        // Verify ZIP contents
        const zip = await JSZip.loadAsync(zipBlob);

        // Check session file
        const sessionFile = zip.file(STORAGE_SESSION_FILE);
        expect(sessionFile).not.toBeNull();
        const sessionContent = await sessionFile!.async('text');
        const parsedSession = JSON.parse(sessionContent);
        expect(parsedSession).toEqual(sessionData);

        // Check notebook folder structure
        const notebookFolder = zip.folder(STORAGE_NOTEBOOK_FOLDER);
        expect(notebookFolder).not.toBeNull();

        // Check page 1 scripts
        const page1Script1 = zip.file(`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`);
        expect(page1Script1).not.toBeNull();
        expect(await page1Script1!.async('text')).toBe('SELECT 1;');

        const page1Script2 = zip.file(`${STORAGE_NOTEBOOK_FOLDER}/page-1/02-script.sql`);
        expect(page1Script2).not.toBeNull();
        expect(await page1Script2!.async('text')).toBe('SELECT 2;');

        // Check page 2 scripts
        const page2Script1 = zip.file(`${STORAGE_NOTEBOOK_FOLDER}/page-2/01-script.sql`);
        expect(page2Script1).not.toBeNull();
        expect(await page2Script1!.async('text')).toBe('SELECT 3;');
    });

    it('includes composer script if present', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid-1',
            sessionPath: 'test-session',
            name: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const pages: PageData[] = [];
        const composerSql = 'SELECT * FROM users;';

        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(composerSql);

        const zipBlob = await exportSessionAsZip('test-session', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        const draftFile = zip.file(`${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        expect(draftFile).not.toBeNull();
        expect(await draftFile!.async('text')).toBe(composerSql);
    });

    it('exports empty notebook without composer script', async () => {
        const sessionData: SessionData = {
            sessionId: 'empty-uuid',
            sessionPath: 'empty-session',
            name: 'Empty Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportSessionAsZip('empty-session', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        // Should have session file
        expect(zip.file(STORAGE_SESSION_FILE)).not.toBeNull();

        // Should have empty notebook folder
        const notebookFolder = zip.folder(STORAGE_NOTEBOOK_FOLDER);
        expect(notebookFolder).not.toBeNull();

        // Should not have draft file
        const draftFile = zip.file(`${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        expect(draftFile).toBeNull();
    });

    it('uses compression for ZIP output', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid-1',
            sessionPath: 'test-session',
            name: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue([]);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportSessionAsZip('test-session', mockBackend);

        // Verify it's a valid blob
        expect(zipBlob).toBeInstanceOf(Blob);
        expect(zipBlob.type).toBe('application/zip');

        // Verify it can be loaded back
        const zip = await JSZip.loadAsync(zipBlob);
        expect(zip).toBeDefined();
    });

    it('handles pages with no scripts', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid-1',
            sessionPath: 'test-session',
            name: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const pages: PageData[] = [
            { name: 'page-1', scripts: [] },
            { name: 'page-2', scripts: [] },
        ];

        vi.mocked(mockBackend.loadSession).mockResolvedValue(sessionData);
        vi.mocked(mockBackend.loadNotebookPages).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadNotebookScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportSessionAsZip('test-session', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        // Should have page folders even if empty
        expect(zip.folder(`${STORAGE_NOTEBOOK_FOLDER}/page-1`)).not.toBeNull();
        expect(zip.folder(`${STORAGE_NOTEBOOK_FOLDER}/page-2`)).not.toBeNull();
    });
});

describe('exportSessionAsSharedZip', () => {
    /// A minimal StorageBackend serving a single stored session with no pages/draft.
    /// exportSessionAsSharedZip reads the session/pages/draft from here and rewrites only the
    /// connection params for sharing, so the tests only care about what lands in dashql-session.json.
    /// The stored session name (if any) is passed through untouched.
    function makeBackend(sessionId: string, name?: string): StorageBackend {
        const sessionData = {
            sessionId,
            sessionPath: sessionId,
            ...(name ? { name } : {}),
            connectionParams: { dataless: {} },
            notebook: { originalFileName: 'notebook.sql' },
        } as unknown as SessionData;
        return {
            getBackendType: vi.fn(() => StorageBackendType.OPFS),
            loadSession: vi.fn().mockResolvedValue(sessionData),
            loadNotebookPages: vi.fn().mockResolvedValue([]),
            loadNotebookScriptDraft: vi.fn().mockResolvedValue(null),
        } as unknown as StorageBackend;
    }

    async function readSessionData(zipBlob: Blob): Promise<any> {
        const zip = await JSZip.loadAsync(zipBlob);
        const sessionFile = zip.file(STORAGE_SESSION_FILE);
        expect(sessionFile).not.toBeNull();
        return JSON.parse(await sessionFile!.async('text'));
    }

    const connectionParams = { dataless: {} };

    it('carries the stored session name through so a shared link restores under the same label', async () => {
        const zipBlob = await exportSessionAsSharedZip(makeBackend('uuid-1', 'My Analysis'), 'uuid-1', connectionParams);
        const session = await readSessionData(zipBlob);
        expect(session.name).toBe('My Analysis');
    });

    it('omits the name when the stored session was never named', async () => {
        const zipBlob = await exportSessionAsSharedZip(makeBackend('uuid-1'), 'uuid-1', connectionParams);
        const session = await readSessionData(zipBlob);
        expect('name' in session).toBe(false);
    });

    it('shares the salesforce identity without the consumer secret when connection info is included', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await exportSessionAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true);
        const session = await readSessionData(zipBlob);
        expect(session.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(session.connectionParams.salesforce.login).toBe('user@example.com');
        expect(session.connectionParams.salesforce.appConsumerSecret).toBe('');
    });

    it('drops the login hint but keeps the rest of the salesforce identity when withLoginHint is off', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await exportSessionAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true, false);
        const session = await readSessionData(zipBlob);
        expect(session.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(session.connectionParams.salesforce.login).toBe('');
        expect(session.connectionParams.salesforce.appConsumerSecret).toBe('');
    });

    it('drops all connection info to a dataless session when the toggle is off', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await exportSessionAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, false);
        const session = await readSessionData(zipBlob);
        expect('salesforce' in session.connectionParams).toBe(false);
        expect('dataless' in session.connectionParams).toBe(true);
    });
});
