import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUNDLED_NOTEBOOKS } from './bundled_notebooks.js';
import type { NotebookData, NotebookIndexData } from './storage_backend.js';
import { validateNotebookData } from './notebook_validation.js';

const EXAMPLES_DIR = resolve(process.cwd(), '../../examples/notebooks');
describe('bundled V2 notebooks', () => {
    it.each(BUNDLED_NOTEBOOKS)('$name has a valid manifest and an exact flat script index', notebook => {
        const manifestPathSegments = notebook.manifestPath.split('/');
        const notebookDir = resolve(EXAMPLES_DIR, manifestPathSegments[manifestPathSegments.length - 2]);
        const manifest = JSON.parse(readFileSync(resolve(notebookDir, 'dashql-notebook.json'), 'utf8')) as NotebookData;
        const index = JSON.parse(readFileSync(resolve(notebookDir, 'dashql-notebook-index.json'), 'utf8')) as NotebookIndexData;
        const scriptEntries = readdirSync(resolve(notebookDir, 'scripts'), { withFileTypes: true });
        const scriptNames = scriptEntries
            .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
            .map(entry => entry.name)
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

        expect(validateNotebookData(manifest)).toEqual({ ok: true });
        expect(manifest.notebookId).toBe(notebook.notebookId);
        expect(manifest).not.toHaveProperty('nativePath');
        expect(scriptEntries.filter(entry => entry.isDirectory()).map(entry => entry.name)).toEqual([]);
        expect(index).toEqual({ scripts: scriptNames.map(name => ({ name })) });
    });
});
