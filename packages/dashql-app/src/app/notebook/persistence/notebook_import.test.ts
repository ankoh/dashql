import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

import { importNotebookFromZip, readNotebookBundleFromZip } from './notebook_import.js';
import type { NotebookData, StorageBackend } from './storage_backend.js';
import {
    STORAGE_NOTEBOOK_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_DRAFT,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
    StorageBackendType,
} from './storage_backend.js';

const SOURCE_ID = '11111111-2222-3333-4444-555555555555';
const NEW_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function notebook(overrides: Partial<NotebookData> = {}): NotebookData {
    return {
        notebookId: SOURCE_ID,
        name: 'Original Notebook',
        connectionParams: { hyper: {} } as any,
        metadata: {},
        ...overrides,
    };
}

async function createZipBlob(files: Record<string, string>): Promise<Blob> {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
    }
    return await zip.generateAsync({ type: 'blob' });
}

function createBackend(type: StorageBackendType = StorageBackendType.OPFS): StorageBackend {
    return {
        getBackendType: vi.fn(() => type),
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
        loadQueryResultCache: vi.fn(),
        saveQueryResultCache: vi.fn(),
        listQueryResultCache: vi.fn(),
        hasCachedQueryResult: vi.fn(),
        touchQueryResultCacheAccess: vi.fn(),
        deleteQueryResultCache: vi.fn(),
        loadAppSettings: vi.fn(),
        saveAppSettings: vi.fn(),
    };
}

describe('readNotebookBundleFromZip', () => {
    it('fully reads durable notebook data and ignores unrelated and derived files', async () => {
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [STORAGE_SCRIPT_SCHEMA]: 'CREATE TABLE example(id int);',
            [STORAGE_SCRIPT_FUNCTIONS]: 'CREATE FUNCTION answer() RETURNS int RETURN 42;',
            [`${STORAGE_SCRIPTS_FOLDER}/10_later/2_second.sql`]: 'SELECT 2;',
            [`${STORAGE_SCRIPTS_FOLDER}/2_first/10_tenth.sql`]: 'SELECT 10;',
            [`${STORAGE_SCRIPTS_FOLDER}/2_first/1_first.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`]: 'SELECT draft;',
            'cache/result.arrow': 'derived',
            '.gitignore': 'cache/',
            'README.md': 'unrelated',
            'dashql-notebook-index.json': '{"folders":[]}',
            'other.sql': 'unrelated SQL',
        });

        await expect(readNotebookBundleFromZip(zipBlob)).resolves.toEqual({
            notebook: notebook(),
            schemaSql: 'CREATE TABLE example(id int);',
            functionsSql: 'CREATE FUNCTION answer() RETURNS int RETURN 42;',
            folders: [
                {
                    name: '2_first',
                    scripts: [
                        { name: '1_first.sql', sql: 'SELECT 1;' },
                        { name: '10_tenth.sql', sql: 'SELECT 10;' },
                    ],
                },
                { name: '10_later', scripts: [{ name: '2_second.sql', sql: 'SELECT 2;' }] },
            ],
            draftSql: 'SELECT draft;',
        });
    });

    it('preserves explicitly empty script folders', async () => {
        const zip = new JSZip();
        zip.file(STORAGE_NOTEBOOK_FILE, JSON.stringify(notebook()));
        zip.folder(`${STORAGE_SCRIPTS_FOLDER}/empty`);

        const bundle = await readNotebookBundleFromZip(await zip.generateAsync({ type: 'blob' }));

        expect(bundle.folders).toEqual([{ name: 'empty', scripts: [] }]);
    });

    it('rejects direct and nested SQL files instead of flattening them', async () => {
        const direct = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [`${STORAGE_SCRIPTS_FOLDER}/query.sql`]: 'SELECT 1;',
        });
        const nested = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [`${STORAGE_SCRIPTS_FOLDER}/folder/nested/query.sql`]: 'SELECT 1;',
        });

        await expect(readNotebookBundleFromZip(direct)).rejects.toThrow(
            'SQL scripts must be directly inside a script folder',
        );
        await expect(readNotebookBundleFromZip(nested)).rejects.toThrow(
            'SQL scripts must be directly inside a script folder',
        );
    });

    it('rejects duplicate normalized destinations', async () => {
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [`${STORAGE_SCRIPTS_FOLDER}/caf\u00e9/query.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/cafe\u0301/query.sql`]: 'SELECT 2;',
        });

        await expect(readNotebookBundleFromZip(zipBlob)).rejects.toThrow('duplicate destination');
    });

    it('rejects missing, malformed, and invalid source metadata', async () => {
        const missing = await createZipBlob({ 'README.md': 'nothing' });
        const malformed = await createZipBlob({ [STORAGE_NOTEBOOK_FILE]: '{' });
        const invalid = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook({ notebookId: 'not-a-uuid' })),
        });

        await expect(readNotebookBundleFromZip(missing)).rejects.toThrow(`missing ${STORAGE_NOTEBOOK_FILE}`);
        await expect(readNotebookBundleFromZip(malformed)).rejects.toThrow(`invalid ${STORAGE_NOTEBOOK_FILE}`);
        await expect(readNotebookBundleFromZip(invalid)).rejects.toThrow('Invalid notebook id');
    });
});

describe('importNotebookFromZip', () => {
    let backend: StorageBackend;

    beforeEach(() => {
        backend = createBackend();
    });

    it('preserves the authoritative source UUID by default and writes every durable file', async () => {
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [STORAGE_SCRIPT_SCHEMA]: 'schema SQL',
            [STORAGE_SCRIPT_FUNCTIONS]: 'functions SQL',
            [`${STORAGE_SCRIPTS_FOLDER}/page/1_query.sql`]: 'SELECT 1;',
            [`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`]: 'draft SQL',
        });

        const importedId = await importNotebookFromZip(zipBlob, backend);

        expect(importedId).toBe(SOURCE_ID);
        expect(backend.saveNotebookManifest).toHaveBeenCalledWith(
            SOURCE_ID,
            expect.objectContaining({ notebookId: SOURCE_ID }),
        );
        expect(backend.saveNotebookSchema).toHaveBeenCalledWith(SOURCE_ID, 'schema SQL');
        expect(backend.saveNotebookFunctions).toHaveBeenCalledWith(SOURCE_ID, 'functions SQL');
        expect(backend.createScriptFolder).toHaveBeenCalledWith(SOURCE_ID, 'page');
        expect(backend.saveScript).toHaveBeenCalledWith(SOURCE_ID, 'page', '1_query.sql', 'SELECT 1;');
        expect(backend.saveScriptDraft).toHaveBeenCalledWith(SOURCE_ID, 'draft SQL');
    });

    it('uses a caller-selected fresh UUID and suffixes only a nonblank name when explicitly requested', async () => {
        const namedZip = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook({ name: '  Analysis  ' })),
        });

        const importedId = await importNotebookFromZip(namedZip, backend, {
            targetNotebookId: NEW_ID,
            suffixNameWithCopy: true,
            targetIsFresh: true,
        });

        expect(importedId).toBe(NEW_ID);
        expect(backend.saveNotebookManifest).toHaveBeenCalledWith(
            NEW_ID,
            expect.objectContaining({ notebookId: NEW_ID, name: 'Analysis (copy)' }),
        );

        vi.clearAllMocks();
        const blankZip = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook({ name: '   ' })),
        });
        await importNotebookFromZip(blankZip, backend, {
            targetNotebookId: NEW_ID,
            suffixNameWithCopy: true,
        });
        expect(backend.saveNotebookManifest).toHaveBeenCalledWith(
            NEW_ID,
            expect.objectContaining({ name: '   ' }),
        );
    });

    it('imports under an explicit fresh UUID', async () => {
        const zipBlob = await createZipBlob({ [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()) });

        await expect(importNotebookFromZip(zipBlob, backend, {
            targetNotebookId: NEW_ID,
            targetIsFresh: true,
        })).resolves.toBe(NEW_ID);

        expect(backend.saveNotebookManifest).toHaveBeenCalledWith(
            NEW_ID,
            expect.objectContaining({ notebookId: NEW_ID }),
        );
    });

    it('normalizes location metadata for OPFS but not native storage', async () => {
        const source = notebook({
            notebookPath: 'fs:///source/notebook',
            storageType: StorageBackendType.Native,
            nativePath: '/source/notebook',
        });
        const zipBlob = await createZipBlob({ [STORAGE_NOTEBOOK_FILE]: JSON.stringify(source) });

        await importNotebookFromZip(zipBlob, backend);
        const opfsData = vi.mocked(backend.saveNotebookManifest).mock.calls[0][1];
        expect(opfsData.notebookPath).toBeUndefined();
        expect(opfsData.storageType).toBeUndefined();
        expect(opfsData.nativePath).toBeUndefined();

        const nativeBackend = createBackend(StorageBackendType.Native);
        await importNotebookFromZip(zipBlob, nativeBackend);
        expect(nativeBackend.saveNotebookManifest).toHaveBeenCalledWith(SOURCE_ID, source);
    });

    it('validates and parses the whole bundle before allocating an ID or writing', async () => {
        const invalidMetadata = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook({ notebookId: 'invalid' })),
            [`${STORAGE_SCRIPTS_FOLDER}/page/query.sql`]: 'SELECT 1;',
        });
        const invalidScripts = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [`${STORAGE_SCRIPTS_FOLDER}/page/nested/query.sql`]: 'SELECT 1;',
        });

        await expect(importNotebookFromZip(invalidMetadata, backend, { targetNotebookId: NEW_ID })).rejects.toThrow();
        await expect(importNotebookFromZip(invalidScripts, backend, { targetNotebookId: NEW_ID })).rejects.toThrow();

        expect(backend.saveNotebookManifest).not.toHaveBeenCalled();
        expect(backend.createScriptFolder).not.toHaveBeenCalled();
        expect(backend.saveScript).not.toHaveBeenCalled();
    });

    it('deletes a failed target only when the caller declares it fresh', async () => {
        const zipBlob = await createZipBlob({
            [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()),
            [`${STORAGE_SCRIPTS_FOLDER}/page/query.sql`]: 'SELECT 1;',
        });
        vi.mocked(backend.saveScript).mockRejectedValue(new Error('write failed'));

        await expect(importNotebookFromZip(zipBlob, backend, {
            targetNotebookId: NEW_ID,
            targetIsFresh: true,
        })).rejects.toThrow('write failed');
        expect(backend.deleteNotebook).toHaveBeenCalledWith(NEW_ID);

        vi.clearAllMocks();
        vi.mocked(backend.saveScript).mockRejectedValue(new Error('write failed'));
        await expect(importNotebookFromZip(zipBlob, backend, {
            targetNotebookId: SOURCE_ID,
        })).rejects.toThrow('write failed');
        expect(backend.deleteNotebook).not.toHaveBeenCalled();
    });

    it('requires an explicit target UUID before enabling fresh-target rollback', async () => {
        const zipBlob = await createZipBlob({ [STORAGE_NOTEBOOK_FILE]: JSON.stringify(notebook()) });

        await expect(importNotebookFromZip(zipBlob, backend, { targetIsFresh: true }))
            .rejects.toThrow('targetIsFresh requires an explicit targetNotebookId');
        expect(backend.saveNotebookManifest).not.toHaveBeenCalled();
        expect(backend.deleteNotebook).not.toHaveBeenCalled();
    });
});
