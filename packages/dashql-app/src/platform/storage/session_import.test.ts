import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { importSessionFromZip } from './session_import.js';
import { type StorageBackend, type SessionData, StorageBackendType } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

// The UUID the allocator hands back for an imported session.
const NEW_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('importSessionFromZip', () => {
    let mockBackend: StorageBackend;
    let allocateSessionId: () => string;

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
            loadNotebookScript: vi.fn(),
            saveNotebookScript: vi.fn(),
            deleteNotebookScript: vi.fn(),
            loadNotebookScriptDraft: vi.fn(),
            saveNotebookScriptDraft: vi.fn(),
            loadAppSettings: vi.fn(),
            saveAppSettings: vi.fn(),
        };

        allocateSessionId = vi.fn(() => NEW_ID);
    });

    async function createZipBlob(files: Record<string, string>): Promise<Blob> {
        const zip = new JSZip();
        for (const [path, content] of Object.entries(files)) {
            zip.file(path, content);
        }
        return await zip.generateAsync({ type: 'blob' });
    }

    it('imports a session with metadata and notebook pages', async () => {
        const sessionData: SessionData = {
            sessionId: 'original-uuid',
            sessionPath: 'original-session',
            title: 'Original Session',
            connectionParams: { dataless: {} },
            notebook: {
                originalFileName: 'test.sql',
                createdAt: '2024-01-01T00:00:00Z',
            },
        };

        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/02-script.sql`]: 'SELECT 2;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-2/01-script.sql`]: 'SELECT 3;',
        });

        const newSessionId = await importSessionFromZip(
            zipBlob,
            mockBackend,
            allocateSessionId
        );

        // The import returns the freshly-allocated bare UUID.
        expect(newSessionId).toBe(NEW_ID);
        expect(allocateSessionId).toHaveBeenCalledTimes(1);

        // Verify the session was saved keyed by the new UUID, which is also stamped onto the data.
        expect(mockBackend.saveSessionManifest).toHaveBeenCalledTimes(1);
        const savedCall = vi.mocked(mockBackend.saveSessionManifest).mock.calls[0];
        expect(savedCall[0]).toBe(NEW_ID);  // First arg is the session UUID (routing key)
        expect(savedCall[1].sessionId).toBe(NEW_ID);
        expect(savedCall[1].title).toBe('Original Session');
        // The display-only sessionPath is dropped on import; it is reconstructed from the UUID for the UI.
        expect(savedCall[1].sessionPath).toBeUndefined();

        // Verify pages were created keyed by the new UUID
        expect(mockBackend.createNotebookPage).toHaveBeenCalledTimes(2);
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith(NEW_ID, 'page-1');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith(NEW_ID, 'page-2');

        // Verify scripts were saved
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '02-script.sql', 'SELECT 2;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'page-2', '01-script.sql', 'SELECT 3;');
    });

    it('imports composer script if present', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid',
            sessionPath: 'test-session',
            title: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const composerSql = 'SELECT * FROM users;';

        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`]: composerSql,
        });

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionId);

        expect(mockBackend.saveNotebookScriptDraft).toHaveBeenCalledWith(NEW_ID, composerSql);
    });

    it('handles empty notebook', async () => {
        const sessionData: SessionData = {
            sessionId: 'empty-uuid',
            sessionPath: 'empty-session',
            title: 'Empty Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
        });

        const newSessionId = await importSessionFromZip(
            zipBlob,
            mockBackend,
            allocateSessionId
        );

        expect(newSessionId).toBe(NEW_ID);
        expect(mockBackend.saveSessionManifest).toHaveBeenCalledTimes(1);
        expect(mockBackend.createNotebookPage).not.toHaveBeenCalled();
        expect(mockBackend.saveNotebookScript).not.toHaveBeenCalled();
        expect(mockBackend.saveNotebookScriptDraft).not.toHaveBeenCalled();
    });

    it('throws error when session file is missing', async () => {
        const zipBlob = await createZipBlob({
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
        });

        await expect(
            importSessionFromZip(zipBlob, mockBackend, allocateSessionId)
        ).rejects.toThrow(`Invalid ZIP: missing ${STORAGE_SESSION_FILE}`);
    });

    it('sorts pages by name during import', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid',
            sessionPath: 'test-session',
            title: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        // Create pages in non-sequential order
        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/page-3/01-script.sql`]: 'SELECT 3;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-2/01-script.sql`]: 'SELECT 2;',
        });

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionId);

        // Pages should be created in sorted order
        const calls = vi.mocked(mockBackend.createNotebookPage).mock.calls;
        expect(calls[0]).toEqual([NEW_ID, 'page-1']);
        expect(calls[1]).toEqual([NEW_ID, 'page-2']);
        expect(calls[2]).toEqual([NEW_ID, 'page-3']);
    });

    it('sorts scripts within pages by name during import', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid',
            sessionPath: 'test-session',
            title: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        // Create scripts in non-sequential order
        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/03-script.sql`]: 'SELECT 3;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/02-script.sql`]: 'SELECT 2;',
        });

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionId);

        // Scripts should be saved in sorted order
        const calls = vi.mocked(mockBackend.saveNotebookScript).mock.calls;
        expect(calls[0]).toEqual([NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;']);
        expect(calls[1]).toEqual([NEW_ID, 'page-1', '02-script.sql', 'SELECT 2;']);
        expect(calls[2]).toEqual([NEW_ID, 'page-1', '03-script.sql', 'SELECT 3;']);
    });

    it('ignores non-SQL files in page folders', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid',
            sessionPath: 'test-session',
            title: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/readme.txt`]: 'Not a SQL file',
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/config.json`]: '{}',
        });

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionId);

        // Only the SQL file should be imported
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(1);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
    });

    it('imports all page folders regardless of naming', async () => {
        const sessionData: SessionData = {
            sessionId: 'test-uuid',
            sessionPath: 'test-session',
            title: 'Test Session',
            connectionParams: { dataless: {} },
            notebook: {},
        };

        const zipBlob = await createZipBlob({
            [STORAGE_SESSION_FILE]: JSON.stringify(sessionData),
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
            [`${STORAGE_NOTEBOOK_FOLDER}/invalid/01-script.sql`]: 'SELECT INVALID;',
            [`${STORAGE_NOTEBOOK_FOLDER}/temp/01-script.sql`]: 'SELECT TEMP;',
        });

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionId);

        // All three pages should be created (sorted lexicographically)
        expect(mockBackend.createNotebookPage).toHaveBeenCalledTimes(3);
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith(NEW_ID, 'invalid');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith(NEW_ID, 'page-1');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith(NEW_ID, 'temp');

        // All scripts should be saved
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'invalid', '01-script.sql', 'SELECT INVALID;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith(NEW_ID, 'temp', '01-script.sql', 'SELECT TEMP;');
    });
});
