import { describe, expect, it } from 'vitest';

import { BUNDLED_NOTEBOOKS, bundledNotebookShareUrl, resolveBundledNotebookUrl } from './bundled_notebooks.js';

describe('bundled notebooks', () => {
    it('resolves the same root paths for web and packaged app origins', () => {
        expect(BUNDLED_NOTEBOOKS.map(notebook =>
            resolveBundledNotebookUrl(notebook, new URL('https://dashql.app/notebooks')).toString(),
        )).toEqual([
            'https://dashql.app/static/examples/notebooks/explain/dashql-notebook.json',
            'https://dashql.app/static/examples/notebooks/hello-docker/dashql-notebook.json',
            'https://dashql.app/static/examples/notebooks/hello-wasm/dashql-notebook.json',
        ]);
        expect(resolveBundledNotebookUrl(BUNDLED_NOTEBOOKS[0], new URL('app://bundle/index.html')).toString())
            .toBe('app://bundle/static/examples/notebooks/explain/dashql-notebook.json');
    });

    it('creates public share links for bundled notebooks', () => {
        expect(bundledNotebookShareUrl(BUNDLED_NOTEBOOKS[0])).toBe(
            'https://dashql.app?notebook=https%3A%2F%2Fdashql.app%2Fstatic%2Fexamples%2Fnotebooks%2Fexplain%2Fdashql-notebook.json',
        );
    });
});
