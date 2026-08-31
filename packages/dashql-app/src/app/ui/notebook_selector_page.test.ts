import { describe, expect, it } from 'vitest';

import { reorderNotebookIds } from './notebook_selector_page.js';

describe('reorderNotebookIds', () => {
    it('applies consecutive moves to the latest order', () => {
        const first = reorderNotebookIds(['a', 'b', 'c'], 'a', 'c');
        const second = reorderNotebookIds(first, 'b', 'c');

        expect(first).toEqual(['b', 'c', 'a']);
        expect(second).toEqual(['c', 'b', 'a']);
    });

    it('keeps the existing array when a drag cannot change the order', () => {
        const ids = ['a', 'b'];

        expect(reorderNotebookIds(ids, 'missing', 'b')).toBe(ids);
        expect(reorderNotebookIds(ids, 'a', 'a')).toBe(ids);
    });
});
