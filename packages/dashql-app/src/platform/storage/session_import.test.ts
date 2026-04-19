import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { importSessionFromZip } from './session_import.js';
import type { StorageBackend, SessionData } from './storage_backend.js';
import { STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

describe('importSessionFromZip', () => {
    let mockBackend: StorageBackend;
    let allocateSessionPath: () => string;

    beforeEach(() => {
        mockBackend = {
            getSchemaPrefix: vi.fn(() => 'mock://'),
            constructSessionPath: vi.fn((sessionId: string) => `mock://sessions/${sessionId}`),
            parseSessionPath: vi.fn((sessionPath: string) => sessionPath.replace('mock://', '')),
            listSessions: vi.fn(),
            loadSession: vi.fn(),
            saveSession: vi.fn(),
            deleteSession: vi.fn(),
            loadSessionSchema: vi.fn(),
            saveSessionSchema: vi.fn(),
            loadNotebookPages: vi.fn(),
            createNotebookPage: vi.fn(),
            deleteNotebookPage: vi.fn(),
            loadNotebookScript: vi.fn(),
            saveNotebookScript: vi.fn(),
            deleteNotebookScript: vi.fn(),
            reorderNotebookScript: vi.fn(),
            loadNotebookScriptDraft: vi.fn(),
            saveNotebookScriptDraft: vi.fn(),
        };

        let counter = 0;
        allocateSessionPath = vi.fn(() => `session-${++counter}`);
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

        const newSessionPath = await importSessionFromZip(
            zipBlob,
            mockBackend,
            allocateSessionPath
        );

        expect(newSessionPath).toBe('session-1');
        expect(allocateSessionPath).toHaveBeenCalledTimes(1);

        // Verify session was saved with new path and new sessionId
        expect(mockBackend.saveSession).toHaveBeenCalledTimes(1);
        const savedCall = vi.mocked(mockBackend.saveSession).mock.calls[0];
        expect(savedCall[0]).toBe('session-1');  // First arg is sessionPath
        expect(savedCall[1].sessionId).toBe('session-1');
        expect(savedCall[1].title).toBe('Original Session');
        // sessionId should be a new UUID, not the original one
        expect(savedCall[1].sessionId).not.toBe('original-uuid');
        expect(savedCall[1].sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        // Verify pages were created
        expect(mockBackend.createNotebookPage).toHaveBeenCalledTimes(2);
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith('session-1', 'page-1');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith('session-1', 'page-2');

        // Verify scripts were saved
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'page-1', '02-script.sql', 'SELECT 2;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'page-2', '01-script.sql', 'SELECT 3;');
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

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionPath);

        expect(mockBackend.saveNotebookScriptDraft).toHaveBeenCalledWith('session-1', composerSql);
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

        const newSessionPath = await importSessionFromZip(
            zipBlob,
            mockBackend,
            allocateSessionPath
        );

        expect(newSessionPath).toBe('session-1');
        expect(mockBackend.saveSession).toHaveBeenCalledTimes(1);
        expect(mockBackend.createNotebookPage).not.toHaveBeenCalled();
        expect(mockBackend.saveNotebookScript).not.toHaveBeenCalled();
        expect(mockBackend.saveNotebookScriptDraft).not.toHaveBeenCalled();
    });

    it('throws error when session file is missing', async () => {
        const zipBlob = await createZipBlob({
            [`${STORAGE_NOTEBOOK_FOLDER}/page-1/01-script.sql`]: 'SELECT 1;',
        });

        await expect(
            importSessionFromZip(zipBlob, mockBackend, allocateSessionPath)
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

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionPath);

        // Pages should be created in sorted order
        const calls = vi.mocked(mockBackend.createNotebookPage).mock.calls;
        expect(calls[0]).toEqual(['session-1', 'page-1']);
        expect(calls[1]).toEqual(['session-1', 'page-2']);
        expect(calls[2]).toEqual(['session-1', 'page-3']);
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

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionPath);

        // Scripts should be saved in sorted order
        const calls = vi.mocked(mockBackend.saveNotebookScript).mock.calls;
        expect(calls[0]).toEqual(['session-1', 'page-1', '01-script.sql', 'SELECT 1;']);
        expect(calls[1]).toEqual(['session-1', 'page-1', '02-script.sql', 'SELECT 2;']);
        expect(calls[2]).toEqual(['session-1', 'page-1', '03-script.sql', 'SELECT 3;']);
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

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionPath);

        // Only the SQL file should be imported
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(1);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'page-1', '01-script.sql', 'SELECT 1;');
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

        await importSessionFromZip(zipBlob, mockBackend, allocateSessionPath);

        // All three pages should be created (sorted lexicographically)
        expect(mockBackend.createNotebookPage).toHaveBeenCalledTimes(3);
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith('session-1', 'invalid');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith('session-1', 'page-1');
        expect(mockBackend.createNotebookPage).toHaveBeenCalledWith('session-1', 'temp');

        // All scripts should be saved
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledTimes(3);
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'invalid', '01-script.sql', 'SELECT INVALID;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'page-1', '01-script.sql', 'SELECT 1;');
        expect(mockBackend.saveNotebookScript).toHaveBeenCalledWith('session-1', 'temp', '01-script.sql', 'SELECT TEMP;');
    });
});
