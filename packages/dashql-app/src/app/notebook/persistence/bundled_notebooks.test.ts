import { describe, expect, it } from 'vitest';

import { BUNDLED_NOTEBOOKS } from './bundled_notebooks.js';
import type { NotebookData, NotebookIndexData } from './storage_backend.js';
import { validateNotebookData } from './notebook_validation.js';

describe('bundled V2 notebooks', () => {
    it.each(BUNDLED_NOTEBOOKS)('$name has a valid manifest and an exact flat script index', async notebook => {
        const notebookBase = notebook.manifestPath.slice(0, notebook.manifestPath.lastIndexOf('/') + 1);
        const [manifestResponse, indexResponse] = await Promise.all([
            fetch(notebook.manifestPath),
            fetch(`${notebookBase}dashql-notebook-index.json`),
        ]);
        expect(manifestResponse.ok).toBe(true);
        expect(indexResponse.ok).toBe(true);
        const manifest = await manifestResponse.json() as NotebookData;
        const index = await indexResponse.json() as NotebookIndexData;
        const scriptNames = index.scripts.map(script => script.name);
        const scripts = await Promise.all(scriptNames.map(name => fetch(`${notebookBase}scripts/${name}`)));

        expect(validateNotebookData(manifest)).toEqual({ ok: true });
        expect(manifest.notebookId).toBe(notebook.notebookId);
        expect(manifest).not.toHaveProperty('nativePath');
        expect(scripts.every(response => response.ok)).toBe(true);
        expect(scriptNames).toEqual([...scriptNames].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
        expect(index).toEqual({ scripts: scriptNames.map(name => ({ name })) });
    });
});
