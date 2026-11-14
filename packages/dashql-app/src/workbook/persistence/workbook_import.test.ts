import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { importWorkbookFromZip as importZip, readWorkbookBundleFromZip as readZip } from './workbook_import.js';
import { STORAGE_WORKBOOK_FILE } from '@ankoh/dashql-runtime/storage/storage_backend';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';

// The archives of older versions hold the files of a workbook folder, they are read without the database
const readWorkbookBundleFromZip = (blob: Blob) => readZip(blob, null);
const importWorkbookFromZip = (blob: Blob, backend: WorkbookTestBackend, options?: Parameters<typeof importZip>[3]) => importZip(blob, backend, null, options);

async function zip(files: Record<string, string>): Promise<Blob> {
    const archive = new JSZip();
    for (const [path, text] of Object.entries(files)) archive.file(path, text);
    return archive.generateAsync({ type: 'blob' });
}

describe('workbook ZIP import of older versions', () => {
    it('appends unlisted scripts in natural order and ignores derived files', async () => {
        const bundle = await readWorkbookBundleFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook()),
            [`connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`]: 'schema',
            [`connections/${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`]: 'functions',
            // The catalog copy of older versions is ignored in a current workbook
            'dashql-catalog-relations.sql': 'stale',
            'scripts/10_last.sql': 'SELECT 10',
            'scripts/2_first.sql': 'SELECT 2',
            'dashql-session-index.json': '{"scripts":[]}',
            'cache/result.arrow': 'derived',
        }));

        expect(bundle).toEqual({
            workbook: testWorkbook({ scripts: [
                { name: '2_first.sql', connectionId: TEST_CONNECTION_ID },
                { name: '10_last.sql', connectionId: TEST_CONNECTION_ID },
            ] }),
            catalogs: [{ connectionId: TEST_CONNECTION_ID, relations: 'schema', functions: 'functions' }],
            data: [],
            scripts: [
                { name: '2_first.sql', sql: 'SELECT 2' },
                { name: '10_last.sql', sql: 'SELECT 10' },
            ],
        });
    });

    it('keeps the order of the listed scripts', async () => {
        const scripts = [
            { name: '10_last.sql', connectionId: TEST_CONNECTION_ID },
            { name: '2_first.sql', connectionId: TEST_CONNECTION_ID },
        ];
        const bundle = await readWorkbookBundleFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook({ scripts })),
            'scripts/10_last.sql': 'SELECT 10',
            'scripts/2_first.sql': 'SELECT 2',
        }));
        expect(bundle.workbook.scripts).toEqual(scripts);
    });

    it('migrates bundles exported by older versions', async () => {
        const bundle = await readWorkbookBundleFromZip(await zip({
            'dashql-notebook.json': JSON.stringify({ ...testWorkbook(), formatVersion: 2, workbookId: undefined, notebookId: TEST_WORKBOOK_ID }),
            'dashql-relations.sql': 'schema',
            'dashql-functions.sql': 'functions',
            'scripts/01_query.sql': 'SELECT 1',
        }));
        expect(bundle.workbook).toEqual(testWorkbook({ scripts: [{ name: '01_query.sql', connectionId: TEST_CONNECTION_ID }] }));
        // The catalog copy of older versions is the catalog of the default connection
        expect(bundle.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: 'schema', functions: 'functions' }]);
        expect(bundle.scripts).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
    });

    it.each([
        ['nested scripts', 'scripts/page/query.sql', 'directly inside scripts/'],
        ['draft scripts', 'scripts/dashql-draft.sql', 'draft scripts are not supported'],
        ['nested attachment', 'attachments/folder/payload.bin', 'directly inside attachments/'],
        ['backslash attachment', 'attachments/payload\\name.bin', 'basename'],
        ['NUL attachment', 'attachments/payload\0.bin', 'basename'],
        ['CSV attachment', 'attachments/payload.csv', 'Only Parquet files can be attached'],
    ])('rejects %s before mutating storage', async (_label, path, message) => {
        const backend = new WorkbookTestBackend();
        await expect(importWorkbookFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook()),
            [path]: 'SELECT 1',
        }), backend)).rejects.toThrow(message);
        expect(backend.calls).toEqual([]);
    });

    it('strictly refuses V1 metadata before allocating or writing', async () => {
        const backend = new WorkbookTestBackend();
        const idFactory = vi.fn(() => crypto.randomUUID());
        await expect(importWorkbookFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify({ ...testWorkbook(), formatVersion: 1 }),
        }), backend, idFactory)).rejects.toThrow('Unsupported workbook format version');
        expect(idFactory).not.toHaveBeenCalled();
        expect(backend.calls).toEqual([]);
    });

    it('writes every flat durable file and can target a fresh UUID', async () => {
        const backend = new WorkbookTestBackend();
        const target = '99999999-8888-4777-8666-555555555555';
        await expect(importWorkbookFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook()),
            [`connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`]: 'schema',
            'scripts/01_query.sql': 'SELECT 1',
        }), backend, { targetWorkbookId: target, targetIsFresh: true })).resolves.toBe(target);

        expect(await backend.loadWorkbook(target)).toMatchObject({ workbookId: target });
        expect(await backend.loadScripts(target)).toEqual([{ name: '01_query.sql', sql: 'SELECT 1' }]);
        // The catalog of the bundle seeds the default connection
        expect([...backend.connectionFiles]).toEqual([[`${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`, 'schema']]);
        expect(backend.workbooks.has(TEST_WORKBOOK_ID)).toBe(false);
    });

    it('keeps the catalog of a connection that has one', async () => {
        const backend = new WorkbookTestBackend();
        await backend.saveConnectionFile(TEST_CONNECTION_ID, 'dashql-catalog-functions.sql', 'stored');
        await importWorkbookFromZip(await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook()),
            [`connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`]: 'schema',
        }), backend);
        expect([...backend.connectionFiles]).toEqual([[`${TEST_CONNECTION_ID}/dashql-catalog-functions.sql`, 'stored']]);
    });

    it('rolls back only a caller-declared fresh target', async () => {
        const backend = new WorkbookTestBackend();
        backend.saveScript = vi.fn(async () => { throw new Error('write failed'); });
        const blob = await zip({
            [STORAGE_WORKBOOK_FILE]: JSON.stringify(testWorkbook()),
            'scripts/01_query.sql': 'SELECT 1',
        });
        const target = '99999999-8888-4777-8666-555555555555';

        await expect(importWorkbookFromZip(blob, backend, { targetWorkbookId: target, targetIsFresh: true }))
            .rejects.toThrow('write failed');
        expect(backend.calls).toContain(`delete-workbook:${target}`);
    });
});
