import * as arrow from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComputationRegistry } from '../../compute/computation_registry.js';
import { COLUMN_SEARCH_SUCCEEDED, RESULT_SEARCH_FAILED, SET_RESULT_SEARCH_PATTERN, type ComputationAction, type TableComputationState } from '../../compute/computation_state.js';
import { type ColumnGroup, DATA_SEARCH_TASK, type ResultSearchState, ROWNUMBER_COLUMN, STRING_COLUMN } from '../../compute/computation_types.js';
import type { DataFrame } from '../../compute/data_frame.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { mockTableComputation, recordingDispatch } from '../../tests/mocks/computation.js';
import { createTestRoot } from '../../tests/react_root.js';
import { useQueryResultSearch } from './use_query_result_search.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const ROWNUM: ColumnGroup = { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } };
const NAME: ColumnGroup = { type: STRING_COLUMN, value: { inputFieldName: 'name', inputFieldType: new arrow.Utf8(), inputFieldNullable: true, statsFields: null, valueIdFieldName: null } };

/// A search of the pattern that was requested but not applied yet
const requested = (search: ResultSearchState, pattern: string): ResultSearchState =>
    ({ ...search, requestedPattern: pattern, requestId: search.requestId + 1, pending: true });

/// A data frame whose connection answers queries with the table, or fails
function queryingDataFrame(answer: () => Promise<arrow.Table>) {
    const query = vi.fn(async (_sql: string) => await answer());
    const dataFrame = { withConnection: vi.fn(async (run: (connection: { query: typeof query }) => unknown) => await run({ query })), destroy: vi.fn(async () => { }) };
    return { query, dataFrame: dataFrame as unknown as DataFrame };
}

describe('useQueryResultSearch', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    function renderSearch(state: TableComputationState, dispatch: (action: ComputationAction) => void) {
        const current = { search: null as ReturnType<typeof useQueryResultSearch> | null };
        function Probe() {
            current.search = useQueryResultSearch(state, dispatch);
            return null;
        }
        root = createTestRoot();
        root.render(<LoggerProvider><ComputationRegistry><Probe /></ComputationRegistry></LoggerProvider>);
        return current;
    }

    it('searches the column names of the result', async () => {
        const { dispatch, ofType } = recordingDispatch();
        const { query, dataFrame } = queryingDataFrame(async () => tableFromArrays({ column_idx: Int32Array.from([0]), column_group_idx: Int32Array.from([1]) }));
        const state = mockTableComputation([ROWNUM, NAME], { dataFrame });
        renderSearch({ ...state, columnSearch: requested(state.columnSearch, 'na') }, dispatch);

        await vi.waitFor(() => expect(ofType(COLUMN_SEARCH_SUCCEEDED)).toHaveLength(1));
        expect(ofType(COLUMN_SEARCH_SUCCEEDED)[0].value).toEqual([1, dataFrame, 1, [1]]);
        expect(query.mock.calls[0][0]).toContain("ILIKE '%na%'");
    });

    it('reports failing column searches', async () => {
        const { dispatch, ofType } = recordingDispatch();
        const { dataFrame } = queryingDataFrame(async () => { throw new Error('query failed'); });
        const state = mockTableComputation([ROWNUM, NAME], { dataFrame });
        renderSearch({ ...state, columnSearch: requested(state.columnSearch, 'na') }, dispatch);

        await vi.waitFor(() => expect(ofType(RESULT_SEARCH_FAILED)).toHaveLength(1));
        expect(ofType(RESULT_SEARCH_FAILED)[0].value).toEqual([1, dataFrame, 'columns', 1, expect.stringContaining('query failed')]);
    });

    it('finds no columns without searchable columns', async () => {
        const { dispatch, ofType } = recordingDispatch();
        const state = mockTableComputation([ROWNUM]);
        renderSearch({ ...state, columnSearch: requested(state.columnSearch, 'na') }, dispatch);
        await vi.waitFor(() => expect(ofType(COLUMN_SEARCH_SUCCEEDED)).toHaveLength(1));
        expect(ofType(COLUMN_SEARCH_SUCCEEDED)[0].value).toEqual([1, state.dataFrame, 1, []]);
    });

    it('schedules the data search of the requested pattern', async () => {
        const { dispatch, scheduled } = recordingDispatch();
        const state = mockTableComputation([ROWNUM, NAME]);
        renderSearch({ ...state, dataSearch: requested(state.dataSearch, 'ann') }, dispatch);
        await vi.waitFor(() => expect(scheduled(DATA_SEARCH_TASK)).toHaveLength(1));
        expect(scheduled(DATA_SEARCH_TASK).map(task => task.value)).toMatchObject([{
            tableId: 1,
            pattern: 'ann',
            requestId: 1,
            rowNumberColumnName: 'rownum',
            columns: [{ columnIdx: 0, columnGroupIdx: 1, fieldName: 'name' }],
        }]);
    });

    it('requests patterns of the table', () => {
        const { dispatch, ofType } = recordingDispatch();
        const search = renderSearch(mockTableComputation([ROWNUM, NAME]), dispatch);
        search.search!.setColumnPattern('a');
        search.search!.setDataPattern('b');
        expect(ofType(SET_RESULT_SEARCH_PATTERN).map(action => action.value)).toEqual([[1, 'columns', 'a'], [1, 'data', 'b']]);
    });
});
