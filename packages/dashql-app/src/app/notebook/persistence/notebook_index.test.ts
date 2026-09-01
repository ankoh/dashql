import { describe, expect, it } from 'vitest';

import { createNotebookIndex, serializeNotebookIndex } from './notebook_index.js';

describe('V2 notebook publication index', () => {
    it('contains only naturally sorted flat script names', () => {
        const index = createNotebookIndex([
            { name: '10_last.sql', sql: 'SELECT 10' },
            { name: '2_first.sql', sql: 'SELECT 2' },
        ]);
        expect(index).toEqual({ scripts: [{ name: '2_first.sql' }, { name: '10_last.sql' }] });
        expect(JSON.parse(serializeNotebookIndex([{ name: '01_query.sql', sql: 'SELECT 1' }]))).toEqual({
            scripts: [{ name: '01_query.sql' }],
        });
    });
});
