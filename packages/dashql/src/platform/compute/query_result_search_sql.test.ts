import { describe, expect, it } from 'vitest';

import { parseDataSearchMatches } from './query_result_search_sql.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';

describe('query result search SQL', () => {
    it('parses Arrow list values into matching column indexes', () => {
        const result = tableFromArrays({
            row_idx: new Int32Array([1, 3]),
            column_indices: [[0, 2], [1]],
        });
        expect(parseDataSearchMatches(result)).toEqual(new Map([
            [1, [0, 2]],
            [3, [1]],
        ]));
    });
});
