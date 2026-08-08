import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { exportNotebookAsZip, exportNotebookAsSharedZip, exportNotebookAsUrl, NotebookLinkTarget } from './notebook_export.js';
import { importNotebookFromZip } from './notebook_import.js';
import { type StorageBackend, type NotebookData, type ScriptFolderData, StorageBackendType } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';
import { BASE64URL_CODEC } from '../../utils/base64.js';

describe('exportNotebookAsZip', () => {
    let mockBackend: StorageBackend;

    beforeEach(() => {
        mockBackend = {
            getBackendType: vi.fn(() => StorageBackendType.OPFS),
            listNotebooks: vi.fn(),
            loadNotebook: vi.fn(),
            saveNotebookManifest: vi.fn(),
            deleteNotebook: vi.fn(),
            loadNotebookSchema: vi.fn(),
            saveNotebookSchema: vi.fn(),
            loadNotebookFunctions: vi.fn(),
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
            touchQueryResultCacheAccess: vi.fn(),
            deleteQueryResultCache: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };
    });

    it('exports a notebook with metadata and script folders', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid-1',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { dataless: {} },
            metadata: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            },
        };

        const pages: ScriptFolderData[] = [
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

        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportNotebookAsZip('test-notebook', mockBackend);

        expect(mockBackend.loadNotebook).toHaveBeenCalledWith('test-notebook');
        expect(mockBackend.loadScriptFolders).toHaveBeenCalledWith('test-notebook');
        expect(mockBackend.loadScriptDraft).toHaveBeenCalledWith('test-notebook');

        // Verify ZIP contents
        const zip = await JSZip.loadAsync(zipBlob);

        // Check notebook file
        const notebookFile = zip.file(STORAGE_NOTEBOOK_FILE);
        expect(notebookFile).not.toBeNull();
        const notebookContent = await notebookFile!.async('text');
        const parsedNotebook = JSON.parse(notebookContent);
        expect(parsedNotebook).toEqual(notebookData);

        // Check notebook folder structure
        const notebookFolder = zip.folder(STORAGE_SCRIPTS_FOLDER);
        expect(notebookFolder).not.toBeNull();

        // Check page 1 scripts
        const page1Script1 = zip.file(`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`);
        expect(page1Script1).not.toBeNull();
        expect(await page1Script1!.async('text')).toBe('SELECT 1;');

        const page1Script2 = zip.file(`${STORAGE_SCRIPTS_FOLDER}/page-1/02-script.sql`);
        expect(page1Script2).not.toBeNull();
        expect(await page1Script2!.async('text')).toBe('SELECT 2;');

        // Check page 2 scripts
        const page2Script1 = zip.file(`${STORAGE_SCRIPTS_FOLDER}/page-2/01-script.sql`);
        expect(page2Script1).not.toBeNull();
        expect(await page2Script1!.async('text')).toBe('SELECT 3;');
    });

    it('includes composer script if present', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid-1',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { dataless: {} },
            metadata: {},
        };

        const pages: ScriptFolderData[] = [];
        const composerSql = 'SELECT * FROM users;';

        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(composerSql);

        const zipBlob = await exportNotebookAsZip('test-notebook', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        const draftFile = zip.file(`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        expect(draftFile).not.toBeNull();
        expect(await draftFile!.async('text')).toBe(composerSql);
    });

    it('exports empty notebook without composer script', async () => {
        const notebookData: NotebookData = {
            notebookId: 'empty-uuid',
            notebookPath: 'empty-notebook',
            name: 'Empty Notebook',
            connectionParams: { dataless: {} },
            metadata: {},
        };

        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportNotebookAsZip('empty-notebook', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        // Should have notebook file
        expect(zip.file(STORAGE_NOTEBOOK_FILE)).not.toBeNull();

        // Should have empty notebook folder
        const notebookFolder = zip.folder(STORAGE_SCRIPTS_FOLDER);
        expect(notebookFolder).not.toBeNull();

        // Should not have draft file
        const draftFile = zip.file(`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        expect(draftFile).toBeNull();
    });

    it('uses compression for ZIP output', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid-1',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { dataless: {} },
            metadata: {},
        };

        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportNotebookAsZip('test-notebook', mockBackend);

        // Verify it's a valid blob
        expect(zipBlob).toBeInstanceOf(Blob);
        expect(zipBlob.type).toBe('application/zip');

        // Verify it can be loaded back
        const zip = await JSZip.loadAsync(zipBlob);
        expect(zip).toBeDefined();
    });

    it('handles pages with no scripts', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid-1',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { dataless: {} },
            metadata: {},
        };

        const pages: ScriptFolderData[] = [
            { name: 'page-1', scripts: [] },
            { name: 'page-2', scripts: [] },
        ];

        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue(pages);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const zipBlob = await exportNotebookAsZip('test-notebook', mockBackend);
        const zip = await JSZip.loadAsync(zipBlob);

        // Should have script folders even if empty
        expect(zip.folder(`${STORAGE_SCRIPTS_FOLDER}/page-1`)).not.toBeNull();
        expect(zip.folder(`${STORAGE_SCRIPTS_FOLDER}/page-2`)).not.toBeNull();
    });

    it('round-trips a notebook URL event payload as an importable notebook ZIP', async () => {
        const notebookData: NotebookData = {
            notebookId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            name: 'Shared Notebook',
            connectionParams: { dataless: {} },
            metadata: {},
        };
        vi.mocked(mockBackend.loadNotebook).mockResolvedValue(notebookData);
        vi.mocked(mockBackend.loadScriptFolders).mockResolvedValue([
            { name: '1_main', scripts: [{ name: '1_query.sql', sql: 'SELECT 1;' }] },
        ]);
        vi.mocked(mockBackend.loadScriptDraft).mockResolvedValue(null);

        const url = await exportNotebookAsUrl(
            mockBackend,
            notebookData.notebookId,
            notebookData.connectionParams,
            NotebookLinkTarget.NATIVE,
        );
        const encodedEvent = url.searchParams.get('data');
        expect(encodedEvent).not.toBeNull();
        const event = JSON.parse(new TextDecoder().decode(BASE64URL_CODEC.decode(encodedEvent!)));

        expect(Object.keys(event)).toEqual(['notebook']);
        const zipBlob = new Blob([BASE64URL_CODEC.decode(event.notebook)], { type: 'application/zip' });
        const zip = await JSZip.loadAsync(zipBlob);
        expect(zip.file('dashql-notebook.json')).not.toBeNull();
        expect(zip.file('scripts/1_main/1_query.sql')).not.toBeNull();
        expect(zip.file('dashql-session.json')).toBeNull();
        expect(zip.file('notebook/1_main/1_query.sql')).toBeNull();

        const importedId = await importNotebookFromZip(
            zipBlob,
            mockBackend,
            () => 'ffffffff-1111-2222-3333-444444444444',
        );
        expect(importedId).toBe('ffffffff-1111-2222-3333-444444444444');
        expect(mockBackend.saveNotebookManifest).toHaveBeenCalledWith(
            importedId,
            expect.objectContaining({ notebookId: importedId, name: 'Shared Notebook' }),
        );
        expect(mockBackend.saveScript).toHaveBeenCalledWith(importedId, '1_main', '1_query.sql', 'SELECT 1;');
    });
});

describe('exportNotebookAsSharedZip', () => {
    /// A minimal StorageBackend serving a single stored notebook with no folders/draft.
    /// exportNotebookAsSharedZip reads the scripts/folders/draft from here and rewrites only the
    /// connection params for sharing, so the tests only care about what lands in dashql-notebook.json.
    /// The stored notebook name (if any) is passed through untouched.
    function makeBackend(notebookId: string, name?: string): StorageBackend {
        const notebookData = {
            notebookId,
            notebookPath: notebookId,
            ...(name ? { name } : {}),
            connectionParams: { dataless: {} },
            metadata: { originalFileName: 'notebook.sql' },
        } as unknown as NotebookData;
        return {
            getBackendType: vi.fn(() => StorageBackendType.OPFS),
            loadNotebook: vi.fn().mockResolvedValue(notebookData),
            loadScriptFolders: vi.fn().mockResolvedValue([]),
            loadScriptDraft: vi.fn().mockResolvedValue(null),
        } as unknown as StorageBackend;
    }

    async function readNotebookData(zipBlob: Blob): Promise<any> {
        const zip = await JSZip.loadAsync(zipBlob);
        const notebookFile = zip.file(STORAGE_NOTEBOOK_FILE);
        expect(notebookFile).not.toBeNull();
        return JSON.parse(await notebookFile!.async('text'));
    }

    const connectionParams = { dataless: {} };

    it('carries the stored notebook name through so a shared link restores under the same label', async () => {
        const zipBlob = await exportNotebookAsSharedZip(makeBackend('uuid-1', 'My Analysis'), 'uuid-1', connectionParams);
        const notebook = await readNotebookData(zipBlob);
        expect(notebook.name).toBe('My Analysis');
    });

    it('omits the name when the stored notebook was never named', async () => {
        const zipBlob = await exportNotebookAsSharedZip(makeBackend('uuid-1'), 'uuid-1', connectionParams);
        const notebook = await readNotebookData(zipBlob);
        expect('name' in notebook).toBe(false);
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
        const zipBlob = await exportNotebookAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true);
        const notebook = await readNotebookData(zipBlob);
        expect(notebook.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(notebook.connectionParams.salesforce.login).toBe('user@example.com');
        expect(notebook.connectionParams.salesforce.appConsumerSecret).toBe('');
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
        const zipBlob = await exportNotebookAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, true, false);
        const notebook = await readNotebookData(zipBlob);
        expect(notebook.connectionParams.salesforce.appConsumerKey).toBe('consumer-key');
        expect(notebook.connectionParams.salesforce.login).toBe('');
        expect(notebook.connectionParams.salesforce.appConsumerSecret).toBe('');
    });

    it('drops all connection info to a dataless notebook when the toggle is off', async () => {
        const sfParams = {
            salesforce: {
                hyperProtocol: 'V3_HTTP',
                instanceUrl: 'https://example.my.salesforce.com',
                appConsumerKey: 'consumer-key',
                appConsumerSecret: 'super-secret',
                login: 'user@example.com',
            },
        };
        const zipBlob = await exportNotebookAsSharedZip(makeBackend('uuid-1'), 'uuid-1', sfParams, false);
        const notebook = await readNotebookData(zipBlob);
        expect('salesforce' in notebook.connectionParams).toBe(false);
        expect('dataless' in notebook.connectionParams).toBe(true);
    });
});
