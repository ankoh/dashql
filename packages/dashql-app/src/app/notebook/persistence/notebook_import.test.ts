import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { importNotebookFromZip } from './notebook_import.js';
import { type StorageBackend, type NotebookData, StorageBackendType } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

// The UUID the allocator hands back for an imported notebook.
const NEW_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('importNotebookFromZip', () => {
    let mockBackend: StorageBackend;
    let allocateNotebookId: () => string;

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
            hasCachedQueryResult: vi.fn(),
            touchQueryResultCacheAccess: vi.fn(),
            deleteQueryResultCache: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };

        allocateNotebookId = vi.fn(() => NEW_ID);
    });

    async function createZipBlob(files: Record<string, string>): Promise<Blob> {
        const zip = new JSZip();
        for (const [path, content] of Object.entries(files)) {
            zip.file(path, content);
        }
        return await zip.generateAsync({ type: 'blob' });
    }

    it('imports a notebook with metadata and script folders', async () => {
        const notebookData: NotebookData = {
            notebookId: 'original-uuid',
            notebookPath: 'original-notebook',
            name: 'Original Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            },
        };

        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/02-script.sql`]: 'SELECT 2;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-2/01-script.sql`]: 'SELECT 3;',
        });

        const newNotebookId = await importNotebookFromZip(
            zipBlob,
            mockBackend,
            allocateNotebookId
        );

        // The import returns the freshly-allocated bare UUID.
        expect(newNotebookId).toBe(NEW_ID);
        expect(allocateNotebookId).toHaveBeenCalledTimes(1);

        // Verify the notebook was saved keyed by the new UUID, which is also stamped onto the data.
        expect(mockBackend.saveNotebookManifest).toHaveBeenCalledTimes(1);
        const savedCall = vi.mocked(mockBackend.saveNotebookManifest).mock.calls[0];
        expect(savedCall[0]).toBe(NEW_ID);  // First arg is the notebook UUID (routing key)
        expect(savedCall[1].notebookId).toBe(NEW_ID);
        expect(savedCall[1].name).toBe('Original Notebook');
        // The display-only notebookPath is dropped on import; it is reconstructed from the UUID for the UI.
        expect(savedCall[1].notebookPath).toBeUndefined();

        // Verify pages were created keyed by the new UUID
        expect(mockBackend.createScriptFolder).toHaveBeenCalledTimes(2);
        expect(mockBackend.createScriptFolder).toHaveBeenCalledWith(NEW_ID, 'page-1');
        expect(mockBackend.createScriptFolder).toHaveBeenCalledWith(NEW_ID, 'page-2');

        // Verify scripts were saved
        expect(mockBackend.saveScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '02-script.sql', 'SELECT 2;');
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'page-2', '01-script.sql', 'SELECT 3;');
    });

    it('imports composer script if present', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        const composerSql = 'SELECT * FROM users;';

        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`]: composerSql,
        });

        await importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId);

        expect(mockBackend.saveScriptDraft).toHaveBeenCalledWith(NEW_ID, composerSql);
    });

    it('handles empty notebook', async () => {
        const notebookData: NotebookData = {
            notebookId: 'empty-uuid',
            notebookPath: 'empty-notebook',
            name: 'Empty Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
        });

        const newNotebookId = await importNotebookFromZip(
            zipBlob,
            mockBackend,
            allocateNotebookId
        );

        expect(newNotebookId).toBe(NEW_ID);
        expect(mockBackend.saveNotebookManifest).toHaveBeenCalledTimes(1);
        expect(mockBackend.createScriptFolder).not.toHaveBeenCalled();
        expect(mockBackend.saveScript).not.toHaveBeenCalled();
        expect(mockBackend.saveScriptDraft).not.toHaveBeenCalled();
    });

    it('throws error when notebook file is missing', async () => {
        const zipBlob = await createZipBlob({
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
        });

        await expect(
            importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId)
        ).rejects.toThrow(`Invalid ZIP: missing ${STORAGE_NOTEBOOK_FILE}`);
    });

    it('removes a partially imported notebook when a script write fails', async () => {
        const notebookData: NotebookData = {
            notebookId: 'original-uuid',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
        });
        vi.mocked(mockBackend.saveScript).mockRejectedValueOnce(new Error('write failed'));

        await expect(importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId))
            .rejects.toThrow('write failed');

        expect(mockBackend.deleteNotebook).toHaveBeenCalledWith(NEW_ID);
    });

    it('sorts pages by name during import', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        // Create pages in non-sequential order
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-3/01-script.sql`]: 'SELECT 3;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-2/01-script.sql`]: 'SELECT 2;',
        });

        await importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId);

        // Pages should be created in sorted order
        const calls = vi.mocked(mockBackend.createScriptFolder).mock.calls;
        expect(calls[0]).toEqual([NEW_ID, 'page-1']);
        expect(calls[1]).toEqual([NEW_ID, 'page-2']);
        expect(calls[2]).toEqual([NEW_ID, 'page-3']);
    });

    it('sorts scripts within pages by name during import', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        // Create scripts in non-sequential order
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/03-script.sql`]: 'SELECT 3;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/02-script.sql`]: 'SELECT 2;',
        });

        await importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId);

        // Scripts should be saved in sorted order
        const calls = vi.mocked(mockBackend.saveScript).mock.calls;
        expect(calls[0]).toEqual([NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;']);
        expect(calls[1]).toEqual([NEW_ID, 'page-1', '02-script.sql', 'SELECT 2;']);
        expect(calls[2]).toEqual([NEW_ID, 'page-1', '03-script.sql', 'SELECT 3;']);
    });

    it('ignores non-SQL files in script folders', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/readme.txt`]: 'Not a SQL file',
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/config.json`]: '{}',
        });

        await importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId);

        // Only the SQL file should be imported
        expect(mockBackend.saveScript).toHaveBeenCalledTimes(1);
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
    });

    it('imports all script folders regardless of naming', async () => {
        const notebookData: NotebookData = {
            notebookId: 'test-uuid',
            notebookPath: 'test-notebook',
            name: 'Test Notebook',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebookData),
            [`${STORAGE_SCRIPTS_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/invalid/01-script.sql`]: 'SELECT INVALID;',
            [`${STORAGE_SCRIPTS_FOLDER}/temp/01-script.sql`]: 'SELECT TEMP;',
        });

        await importNotebookFromZip(zipBlob, mockBackend, allocateNotebookId);

        // All three pages should be created (sorted lexicographically)
        expect(mockBackend.createScriptFolder).toHaveBeenCalledTimes(3);
        expect(mockBackend.createScriptFolder).toHaveBeenCalledWith(NEW_ID, 'invalid');
        expect(mockBackend.createScriptFolder).toHaveBeenCalledWith(NEW_ID, 'page-1');
        expect(mockBackend.createScriptFolder).toHaveBeenCalledWith(NEW_ID, 'temp');

        // All scripts should be saved
        expect(mockBackend.saveScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'invalid', '01-script.sql', 'SELECT INVALID;');
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveScript).toHaveBeenCalledWith(NEW_ID, 'temp', '01-script.sql', 'SELECT TEMP;');
    });
});
