import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { exportNotebookAsZip } from './notebook_export.js';
import { importNotebookFromZip } from './notebook_import.js';
import { NotebookTestBackend, TEST_NOTEBOOK_ID, testNotebook } from './notebook_test_backend.js';

describe('V2 notebook export', () => {
    it('exports only flat scripts and includes catalogs on request', async () => {
        const backend = new NotebookTestBackend();
        await backend.saveNotebookManifest(TEST_NOTEBOOK_ID, testNotebook());
        await backend.saveNotebookSchema(TEST_NOTEBOOK_ID, 'schema');
        await backend.saveNotebookFunctions(TEST_NOTEBOOK_ID, 'functions');
        await backend.saveScript(TEST_NOTEBOOK_ID, '01_first.sql', 'SELECT 1');
        await backend.saveScript(TEST_NOTEBOOK_ID, '02_second.sql', 'SELECT 2');

        const archive = await JSZip.loadAsync(await exportNotebookAsZip(TEST_NOTEBOOK_ID, backend, { withCatalog: true }));
        expect(await archive.file('scripts/01_first.sql')!.async('text')).toBe('SELECT 1');
        expect(await archive.file('scripts/02_second.sql')!.async('text')).toBe('SELECT 2');
        expect(await archive.file('dashql-relations.sql')!.async('text')).toBe('schema');
        expect(await archive.file('dashql-functions.sql')!.async('text')).toBe('functions');
        expect(archive.file(/scripts\/[^/]+\/[^/]+/)).toEqual([]);
        expect(archive.file('scripts/dashql-draft.sql')).toBeNull();
    });

    it('round-trips a flat V2 archive through import', async () => {
        const source = new NotebookTestBackend();
        await source.saveNotebookManifest(TEST_NOTEBOOK_ID, testNotebook());
        await source.saveScript(TEST_NOTEBOOK_ID, '01_query.sql', 'SELECT 42');
        const target = new NotebookTestBackend();

        const blob = await exportNotebookAsZip(TEST_NOTEBOOK_ID, source);
        await expect(importNotebookFromZip(blob, target)).resolves.toBe(TEST_NOTEBOOK_ID);
        expect(await target.loadScripts(TEST_NOTEBOOK_ID)).toEqual([{ name: '01_query.sql', sql: 'SELECT 42' }]);
    });
});
