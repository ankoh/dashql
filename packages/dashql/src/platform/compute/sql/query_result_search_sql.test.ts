import { describe, expect, it } from 'vitest';
import type * as core from '../../../core/index.js';

import { collectSearchableResultColumns, parseDataSearchMatches } from './query_result_search_sql.js';
import { tableFromArrays } from '../../testing/arrow_fixtures.js';

function valueColumn(name: string, fields: Partial<core.ComputationValueColumn> = {}): core.ComputationValueColumn {
    return {
        inputFieldName: name,
        inputFieldType: 'Utf8',
        inputFieldNullable: true,
        statsFields: null,
        binFieldName: null,
        binCount: 0,
        valueIdFieldName: null,
        ...fields,
    };
}

describe('query result search SQL', () => {
    const columnGroups: core.ComputationColumnGroup[] = [
        { type: 'ROWNUMBER', value: { rowNumberFieldName: '_rownum' } },
        { type: 'STRING', value: valueColumn('column_name') },
        { type: 'ORDINAL', value: valueColumn('score', { inputFieldType: 'Float64', binFieldName: '_2_bin', binCount: 8 }) },
        { type: 'LIST', value: valueColumn('tags') },
        { type: 'SKIPPED', value: { inputFieldName: 'blob', inputFieldType: 'Binary', inputFieldNullable: true } },
        { type: 'STRING', value: valueColumn('col"umn') },
    ];

    it('collects original data columns and excludes row numbers and skipped groups', () => {
        expect(collectSearchableResultColumns(columnGroups)).toEqual([
            { columnIdx: 0, columnGroupIdx: 1, fieldName: 'column_name' },
            { columnIdx: 1, columnGroupIdx: 2, fieldName: 'score' },
            { columnIdx: 2, columnGroupIdx: 3, fieldName: 'tags' },
            { columnIdx: 3, columnGroupIdx: 5, fieldName: 'col"umn' },
        ]);
    });

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
