import { afterEach, describe, expect, it } from 'vitest';
import type * as core from '@ankoh/dashql';

import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN, type ColumnGroup, type TableAggregation, type TableComputationState } from '@ankoh/dashql/platform/compute/computation_types';
import { mockTableComputation, recordingDispatch, valueColumn } from '../../tests/mocks/computation.js';
import { createTestRoot } from '../../tests/react_root.js';
import type { DataTableLayout } from './data_table_layout.js';
import { type ComputationDispatch, type CrossFilterController, crossFilterOf, useCrossFilters } from './use_cross_filters.js';

const COLUMNS: ColumnGroup[] = [
    { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
    { type: ORDINAL_COLUMN, value: valueColumn('score', 'Float64', { binFieldName: 'score_bin', binCount: 8 }) },
    { type: STRING_COLUMN, value: valueColumn('name', 'Utf8', { valueIdFieldName: 'name_id' }) },
    { type: STRING_COLUMN, value: valueColumn('note', 'Utf8') },
];
// Every table column belongs to the column group with the same index
const LAYOUT = { columnGroupByColumnIndex: Uint32Array.from([0, 1, 2, 3]) } as unknown as DataTableLayout;

const tableState = (crossFilters: core.ComputationCrossFilter[] = []) => mockTableComputation(COLUMNS, { crossFilters });

describe('useCrossFilters', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    /// Render the hook for a table state and return its latest controller
    function renderCrossFilters(dispatch: ComputationDispatch) {
        const current = { controller: null as CrossFilterController | null };
        function Probe(props: { state: TableComputationState | null }) {
            current.controller = useCrossFilters(props.state, dispatch, LAYOUT);
            return null;
        }
        root = createTestRoot();
        return {
            current,
            render: (state: TableComputationState | null) => root!.render(<Probe state={state} />),
        };
    }

    it('selects ranges of the histograms of ordinal columns only', () => {
        const { dispatch, ofKind } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        hook.render(tableState());
        hook.current.controller!.histogramFilter({} as TableAggregation, 1, {} as never, [1, 2]);
        hook.current.controller!.histogramFilter({} as TableAggregation, 2, {} as never, [1, 2]);
        hook.current.controller!.histogramFilter({} as TableAggregation, 1, {} as never, null);
        expect(ofKind('histogramFilter').map(action => action.value)).toEqual([
            { columnGroup: 1, selection: [1, 2] },
            { columnGroup: 1, selection: null },
        ]);
    });

    it('selects frequent values of string columns with value ids only', () => {
        const { dispatch, ofKind } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        hook.render(tableState([{ kind: 'mostFrequent', column: 2, valueId: 7 }]));
        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 2, {} as never, 7);
        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 1, {} as never, 8);
        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 3, {} as never, 8);
        expect(ofKind('mostFrequentValueFilter').map(action => action.value)).toEqual([{ columnGroup: 2, valueId: 7 }]);
        expect(hook.current.controller!.crossFilters).toEqual([{ kind: 'mostFrequent', column: 2, valueId: 7 }]);
        expect(crossFilterOf(hook.current.controller!.crossFilters, 2)).toEqual({ kind: 'mostFrequent', column: 2, valueId: 7 });
        expect(crossFilterOf(hook.current.controller!.crossFilters, 1)).toBeNull();
    });

    it('asks the runtime for the summaries over the selected rows', () => {
        const { dispatch, ofKind } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        hook.render(tableState());
        hook.current.controller!.requestFilteredColumnAggregation(1);
        expect(ofKind('requestFilteredColumnAggregation').map(action => action.value)).toEqual([{ columnGroup: 1 }]);
    });

    it('keeps its callbacks while the dispatch is the same', () => {
        const { dispatch } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        hook.render(tableState());
        const first = hook.current.controller!;
        hook.render(tableState([{ kind: 'histogram', column: 1, selection: [0, 1] }]));
        expect(hook.current.controller!.histogramFilter).toBe(first.histogramFilter);
        expect(hook.current.controller!.requestFilteredColumnAggregation).toBe(first.requestFilteredColumnAggregation);
    });
});
