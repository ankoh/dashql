import { afterEach, describe, expect, it } from 'vitest';

import type { ComputationColumnGroup, ComputationView } from '@akohn/dashql';
import { ROWNUMBER_COLUMN, STRING_COLUMN } from '@akohn/dashql/platform/compute/computation_types';
import { mockTableComputation, recordingDispatch, valueColumn } from '../../testing/computation_mocks.js';
import { createTestRoot } from '../../testing/react_root.js';
import { useQueryResultSearch } from './use_query_result_search.js';
import type { ComputationDispatch } from '../data_table/data_table.js';

const ROWNUM: ComputationColumnGroup = { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } };
const NAME: ComputationColumnGroup = { type: STRING_COLUMN, value: valueColumn('name', 'Utf8') };

describe('useQueryResultSearch', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    function renderSearch(state: ComputationView | null, dispatch: ComputationDispatch) {
        const current = { search: null as ReturnType<typeof useQueryResultSearch> | null };
        function Probe() {
            current.search = useQueryResultSearch(state, dispatch);
            return null;
        }
        root = createTestRoot();
        root.render(<Probe />);
        return current;
    }

    it('requests the patterns of the table, the runtime searches', () => {
        const { dispatch, ofKind } = recordingDispatch();
        const search = renderSearch(mockTableComputation([ROWNUM, NAME]), dispatch);
        search.search!.setColumnPattern('a');
        search.search!.setDataPattern('b');
        expect(ofKind('setResultSearchPattern').map(action => action.value)).toEqual([
            { search: 'columns', pattern: 'a' },
            { search: 'data', pattern: 'b' },
        ]);
    });

    it('reads the searches of the view', () => {
        const { dispatch } = recordingDispatch();
        const state = mockTableComputation([ROWNUM, NAME]);
        const columnSearch = { ...state.columnSearch, requestedPattern: 'na', appliedPattern: 'na', matchingColumnGroups: [1] };
        const search = renderSearch({ ...state, columnSearch }, dispatch);
        expect(search.search!.columnSearch).toBe(columnSearch);
        expect(search.search!.dataSearch).toBe(state.dataSearch);
        root!.unmount();
        expect(renderSearch(null, dispatch).search!.columnSearch).toBeNull();
    });
});
