import { describe, expect, it } from 'vitest';

import { notebookIdFromPathname, notebookPath } from './router.js';

describe('notebook routes', () => {
    it('builds and reads the canonical notebook route', () => {
        expect(notebookPath('notebook id')).toBe('/notebooks/notebook%20id');
        expect(notebookIdFromPathname('/notebooks/notebook%20id')).toBe('notebook id');
    });

    it('ignores non-notebook and malformed routes', () => {
        expect(notebookIdFromPathname('/')).toBeNull();
        expect(notebookIdFromPathname('/notebooks/%E0%A4%A')).toBeNull();
    });
});
