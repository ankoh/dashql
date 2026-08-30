import { describe, expect, it, vi } from 'vitest';

import { readNotebookBundleFromBrowserFolder } from './browser_notebook_folder.js';
import type { NotebookData } from './storage_backend.js';
import {
    STORAGE_NOTEBOOK_FILE,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_DRAFT,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';

const NOTEBOOK_ID = '11111111-2222-3333-4444-555555555555';

function notebook(overrides: Partial<NotebookData> = {}): NotebookData {
    return {
        notebookId: NOTEBOOK_ID,
        name: 'Browser Notebook',
        connectionParams: { hyper: {} } as any,
        metadata: {},
        ...overrides,
    };
}

function file(path: string, content: string, options: { relativePath?: string } = {}): File {
    const pathParts = path.replace(/\\/g, '/').split('/');
    const name = pathParts[pathParts.length - 1];
    const selected = new File([content], name, { type: 'text/plain' });
    Object.defineProperty(selected, 'webkitRelativePath', {
        value: options.relativePath ?? path,
        configurable: true,
    });
    return selected;
}

function selection(files: readonly File[]): FileList {
    return {
        ...files,
        length: files.length,
        item: index => files[index] ?? null,
        [Symbol.iterator]: () => files[Symbol.iterator](),
    } as FileList;
}

describe('readNotebookBundleFromBrowserFolder', () => {
    it('reads a complete selected folder, strips its root, and naturally sorts folders and scripts', async () => {
        const files = selection([
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`selected/${STORAGE_SCRIPT_SCHEMA}`, 'CREATE TABLE example(id int);'),
            file(`selected/${STORAGE_SCRIPT_FUNCTIONS}`, 'CREATE FUNCTION answer() RETURNS int RETURN 42;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/10_later/2_second.sql`, 'SELECT 2;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/2_first/10_tenth.sql`, 'SELECT 10;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/2_first/1_first.sql`, 'SELECT 1;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`, 'SELECT draft;'),
        ]);

        await expect(readNotebookBundleFromBrowserFolder(files)).resolves.toEqual({
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

    it('uses Windows separators and NFC-normalizes paths after stripping the selected root', async () => {
        const files = [
            file(`notebook\\${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`notebook\\${STORAGE_SCRIPTS_FOLDER}\\cafe\u0301\\query.sql`, 'SELECT 1;'),
        ];

        const bundle = await readNotebookBundleFromBrowserFolder(files);

        expect(bundle.folders).toEqual([
            { name: 'caf\u00e9', scripts: [{ name: 'query.sql', sql: 'SELECT 1;' }] },
        ]);
    });

    it('falls back to File.name when webkitRelativePath is unavailable', async () => {
        const manifest = new File([JSON.stringify(notebook())], STORAGE_NOTEBOOK_FILE);

        await expect(readNotebookBundleFromBrowserFolder([manifest])).resolves.toEqual({
            notebook: notebook(),
            schemaSql: null,
            functionsSql: null,
            folders: [],
            draftSql: null,
        });
    });

    it('rejects selections with multiple root folders', async () => {
        const files = [
            file(`first/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`second/${STORAGE_SCRIPT_SCHEMA}`, 'schema'),
        ];

        await expect(readNotebookBundleFromBrowserFolder(files)).rejects.toThrow('multiple root folders');
    });

    it('rejects absolute paths and traversal', async () => {
        const absolute = [file(`/selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook()))];
        const windowsAbsolute = [file(`C:\\selected\\${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook()))];
        const traversal = [file(`selected/../${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook()))];

        await expect(readNotebookBundleFromBrowserFolder(absolute)).rejects.toThrow('absolute path');
        await expect(readNotebookBundleFromBrowserFolder(windowsAbsolute)).rejects.toThrow('absolute path');
        await expect(readNotebookBundleFromBrowserFolder(traversal)).rejects.toThrow('path traversal');
    });

    it('rejects malformed and invalid notebook metadata after reading all accepted files', async () => {
        const unreadManifest = file(`selected/${STORAGE_NOTEBOOK_FILE}`, '{');
        const acceptedScript = file(`selected/${STORAGE_SCRIPTS_FOLDER}/main/query.sql`, 'SELECT 1;');
        const scriptText = vi.spyOn(acceptedScript, 'text');

        await expect(readNotebookBundleFromBrowserFolder([unreadManifest, acceptedScript]))
            .rejects.toThrow(`invalid ${STORAGE_NOTEBOOK_FILE}`);
        expect(scriptText).toHaveBeenCalledOnce();

        const invalid = [
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook({ notebookId: 'invalid' }))),
        ];
        await expect(readNotebookBundleFromBrowserFolder(invalid)).rejects.toThrow('Invalid notebook id');
    });

    it('rejects direct and deeper scripts instead of flattening them', async () => {
        const manifest = file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook()));
        const direct = file(`selected/${STORAGE_SCRIPTS_FOLDER}/query.sql`, 'SELECT 1;');
        const nested = file(`selected/${STORAGE_SCRIPTS_FOLDER}/main/nested/query.sql`, 'SELECT 1;');

        await expect(readNotebookBundleFromBrowserFolder([manifest, direct]))
            .rejects.toThrow('SQL scripts must be directly inside a script folder');
        await expect(readNotebookBundleFromBrowserFolder([manifest, nested]))
            .rejects.toThrow('SQL scripts must be directly inside a script folder');
    });

    it('rejects duplicate normalized destinations and normalized or case-insensitive folder aliases', async () => {
        const duplicatePath = [
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/caf\u00e9/query.sql`, 'SELECT 1;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/cafe\u0301/query.sql`, 'SELECT 2;'),
        ];
        const duplicateFolder = [
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/Main/first.sql`, 'SELECT 1;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/main/second.sql`, 'SELECT 2;'),
        ];
        const normalizedFolder = [
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/caf\u00e9/first.sql`, 'SELECT 1;'),
            file(`selected/${STORAGE_SCRIPTS_FOLDER}/cafe\u0301/second.sql`, 'SELECT 2;'),
        ];

        await expect(readNotebookBundleFromBrowserFolder(duplicatePath)).rejects.toThrow('duplicate destination');
        await expect(readNotebookBundleFromBrowserFolder(duplicateFolder))
            .rejects.toThrow('duplicate normalized script folder');
        await expect(readNotebookBundleFromBrowserFolder(normalizedFolder))
            .rejects.toThrow('duplicate normalized script folder');
    });

    it('ignores cache, .gitignore, unrelated files, and non-SQL files under scripts', async () => {
        const ignoredFiles = [
            file('selected/cache/result.arrow', 'derived'),
            file('selected/.gitignore', 'cache/'),
            file('selected/README.md', 'unrelated'),
            file('selected/dashql-notebook-index.json', '{"folders":[]}'),
            file('selected/other.sql', 'unrelated SQL'),
            file('selected/scripts/main/notes.txt', 'not a script'),
        ];
        const ignoredReads = ignoredFiles.map(ignored => vi.spyOn(ignored, 'text'));
        const files = [
            file(`selected/${STORAGE_NOTEBOOK_FILE}`, JSON.stringify(notebook())),
            ...ignoredFiles,
        ];

        await expect(readNotebookBundleFromBrowserFolder(files)).resolves.toEqual({
            notebook: notebook(),
            schemaSql: null,
            functionsSql: null,
            folders: [],
            draftSql: null,
        });
        for (const ignoredRead of ignoredReads) {
            expect(ignoredRead).not.toHaveBeenCalled();
        }
    });
});
