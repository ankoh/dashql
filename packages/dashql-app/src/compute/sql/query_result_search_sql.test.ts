import { describe, expect, it } from 'vitest';

import { LIST_COLUMN, ORDINAL_COLUMN, ROWNUMBER_COLUMN, SKIPPED_COLUMN, STRING_COLUMN, type ColumnGroup } from '../computation_types.js';
import {
    buildColumnSearchSQL,
    buildDataSearchSQL,
    collectSearchableResultColumns,
    parseDataSearchMatches,
} from './query_result_search_sql.js';
import * as arrow from 'apache-arrow';

function stringGroup(name: string): ColumnGroup {
    return {
        type: STRING_COLUMN,
        value: {
            inputFieldName: name,
            inputFieldType: {} as any,
            inputFieldNullable: true,
            statsFields: null,
            valueIdFieldName: null,
        },
    };
}

describe('query result search SQL', () => {
    const columnGroups: ColumnGroup[] = [
        {
            type: ROWNUMBER_COLUMN,
            value: { rowNumberFieldName: '_rownum' },
        },
        stringGroup('column_name'),
        {
            type: ORDINAL_COLUMN,
            value: {
                inputFieldName: 'score',
                inputFieldType: {} as any,
                inputFieldNullable: false,
                statsFields: null,
                binFieldName: '_2_bin',
                binCount: 8,
            },
        },
        {
            type: LIST_COLUMN,
            value: {
                inputFieldName: 'tags',
                inputFieldType: {} as any,
                inputFieldNullable: true,
                statsFields: null,
                valueIdFieldName: null,
                umapProjection: null,
            },
        },
        {
            type: SKIPPED_COLUMN,
            value: {
                inputFieldName: 'blob',
                inputFieldType: {} as any,
                inputFieldNullable: true,
            },
        },
        stringGroup('col"umn'),
    ];

    it('collects original data columns and excludes row numbers and skipped groups', () => {
        expect(collectSearchableResultColumns(columnGroups)).toEqual([
            { columnIdx: 0, columnGroupIdx: 1, fieldName: 'column_name' },
            { columnIdx: 1, columnGroupIdx: 2, fieldName: 'score' },
            { columnIdx: 2, columnGroupIdx: 3, fieldName: 'tags' },
            { columnIdx: 3, columnGroupIdx: 5, fieldName: 'col"umn' },
        ]);
    });

    it('inlines searchable column names for substring matching', () => {
        const sql = buildColumnSearchSQL(collectSearchableResultColumns(columnGroups), '_na');
        expect(sql).toBe(
            `SELECT column_idx, column_group_idx\n` +
            `FROM (\n` +
            `    VALUES\n` +
            `        (0, 1, 'column_name'),\n` +
            `        (1, 2, 'score'),\n` +
            `        (2, 3, 'tags'),\n` +
            `        (3, 5, 'col"umn')\n` +
            `) AS columns(column_idx, column_group_idx, name)\n` +
            `WHERE name ILIKE '%_na%'\n` +
            `ORDER BY column_idx`
        );
    });

    it('quotes single quotes in column names and ILIKE patterns', () => {
        const sql = buildColumnSearchSQL(
            [{ columnIdx: 0, columnGroupIdx: 1, fieldName: "o'neil" }],
            "o'neil",
        );
        expect(sql).toContain(`(0, 1, 'o''neil')`);
        expect(sql).toContain(`WHERE name ILIKE '%o''neil%'`);
    });

    it('returns null SQL when there are no searchable columns', () => {
        expect(buildColumnSearchSQL([], 'x')).toBeNull();
        expect(buildDataSearchSQL('__syscols_1', '_rownum', [], 'x')).toBeNull();
    });

    it('searches every original data column independently of column visibility', () => {
        const sql = buildDataSearchSQL(
            '__syscols_1',
            '_rownum',
            collectSearchableResultColumns(columnGroups),
            'search',
        );
        expect(sql).toBe(
            `WITH search AS (\n` +
            `    SELECT "_rownum" AS row_idx, 0 AS column_idx\n` +
            `    FROM "__syscols_1"\n` +
            `    WHERE CAST("column_name" AS TEXT) ILIKE '%search%'\n` +
            `    UNION ALL\n` +
            `    SELECT "_rownum" AS row_idx, 1 AS column_idx\n` +
            `    FROM "__syscols_1"\n` +
            `    WHERE CAST("score" AS TEXT) ILIKE '%search%'\n` +
            `    UNION ALL\n` +
            `    SELECT "_rownum" AS row_idx, 2 AS column_idx\n` +
            `    FROM "__syscols_1"\n` +
            `    WHERE CAST("tags" AS TEXT) ILIKE '%search%'\n` +
            `    UNION ALL\n` +
            `    SELECT "_rownum" AS row_idx, 3 AS column_idx\n` +
            `    FROM "__syscols_1"\n` +
            `    WHERE CAST("col""umn" AS TEXT) ILIKE '%search%'\n` +
            `)\n` +
            `SELECT\n` +
            `    row_idx,\n` +
            `    array_agg(column_idx ORDER BY column_idx) AS column_indices\n` +
            `FROM search\n` +
            `GROUP BY row_idx\n` +
            `ORDER BY row_idx`
        );
    });

    it('parses Arrow list values into matching column indexes', () => {
        const result = arrow.tableFromArrays({
            row_idx: new Int32Array([1, 3]),
            column_indices: [[0, 2], [1]],
        });
        expect(parseDataSearchMatches(result)).toEqual(new Map([
            [1, [0, 2]],
            [3, [1]],
        ]));
    });
});
