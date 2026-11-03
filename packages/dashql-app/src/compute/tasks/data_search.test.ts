import { describe, expect, it, vi } from 'vitest';

import { LoggableException } from '../../platform/logger/logger.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { ComputationStateVersion, type DataSearchTask } from '../computation_types.js';
import type { ComputeQueryExecution } from '../computation_tasks.js';
import { DATA_SEARCH_ROW_FIELD } from '../sql/query_result_search_sql.js';
import { executeReturning, mockDataFrame } from '../../tests/mocks/compute_query.js';
import { searchData } from './data_search.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const TASK: DataSearchTask = {
    tableId: 1,
    tableVersion: new ComputationStateVersion(1, 2),
    inputDataFrame: mockDataFrame('input'),
    rowNumberColumnName: 'rownum',
    columns: [{ columnIdx: 0, columnGroupIdx: 1, fieldName: 'name' }],
    pattern: 'ann',
    requestId: 7,
    abortController: new AbortController(),
};

describe('searchData', () => {
    it('reads the matching rows ordered by row', async () => {
        const table = tableFromArrays({ [DATA_SEARCH_ROW_FIELD]: Int32Array.from([3, 5]) });
        const { dataFrame, executeQuery } = executeReturning(table);

        const result = await searchData(TASK, new TestLogger(), executeQuery);
        expect(result).toEqual({
            inputRowNumberColumnName: 'rownum',
            dataTable: table,
            dataFrame,
            version: TASK.tableVersion,
            requestId: 7,
        });
        expect(vi.mocked(executeQuery).mock.calls[0][0]).toContain('input');
        expect(dataFrame.readTable).toHaveBeenCalledWith({ orderBy: [{ field: DATA_SEARCH_ROW_FIELD }], abort: TASK.abortController.signal });
    });

    it('destroys the data frame if reading fails', async () => {
        const { dataFrame, executeQuery } = executeReturning(async () => { throw new Error('read failed'); });
        await expect(searchData(TASK, new TestLogger(), executeQuery)).rejects.toThrow('Failed to search table data');
        expect(dataFrame.destroy).toHaveBeenCalledOnce();
    });

    it('passes loggable errors through', async () => {
        const error = new LoggableException('aborted', {}, 'test');
        const executeQuery = vi.fn(async () => { throw error; }) as unknown as ComputeQueryExecution;
        await expect(searchData(TASK, new TestLogger(), executeQuery)).rejects.toBe(error);
    });
});
