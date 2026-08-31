import { describe, expect, it } from 'vitest';

import { BUNDLED_NOTEBOOKS, bundledNotebookShareUrl, resolveBundledNotebookUrl } from './bundled_notebooks.js';

describe('bundled notebooks', () => {
    it('creates public share links for bundled notebooks', () => {
        expect(bundledNotebookShareUrl(BUNDLED_NOTEBOOKS[0])).toBe(
            'https://dashql.app?notebook=https%3A%2F%2Fdashql.app%2Fstatic%2Fexamples%2Fnotebooks%2Fdemo%2Fdashql-notebook.json',
        );
    });
});
