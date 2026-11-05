import * as arrow from 'apache-arrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SET_CROSS_FILTERS, type ComputationAction, type TableComputationState } from '../../compute/computation_state.js';
import { CrossFilters } from '../../compute/cross_filters.js';
import {
    type ColumnAggregationVariant,
    type ColumnGroup,
    type DataSearchTable,
    type FilterTable,
    FILTERED_COLUMN_AGGREGATION_TASK,
    ORDINAL_COLUMN,
    ROWNUMBER_COLUMN,
    STRING_COLUMN,
    type TableAggregation,
    TABLE_FILTERING_TASK,
    TaskStatus,
} from '../../compute/computation_types.js';
import type { ScalarFilter } from '../../compute/sql/sqlframe_builder.js';
import { mockTableComputation, recordingDispatch } from '../../tests/mocks/computation.js';
import { createTestRoot } from '../../tests/react_root.js';
import type { DataTableLayout } from './data_table_layout.js';
import { type CrossFilterController, useCrossFilters } from './use_cross_filters.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

const SCORE = {
    inputFieldName: 'score',
    inputFieldType: new arrow.Float64(),
    inputFieldNullable: true,
    statsFields: null,
    binFieldName: 'score_bin',
    binCount: 8,
};
const NAME = { inputFieldName: 'name', inputFieldType: new arrow.Utf8(), inputFieldNullable: true, statsFields: null, valueIdFieldName: 'name_id' };
const COLUMNS: ColumnGroup[] = [
    { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
    { type: ORDINAL_COLUMN, value: SCORE },
    { type: STRING_COLUMN, value: NAME },
];
// Every table column belongs to the column group with the same index
const LAYOUT = { columnGroupByColumnIndex: Uint32Array.from([0, 1, 2]) } as unknown as DataTableLayout;

const tableState = (crossFilters = new CrossFilters()) => mockTableComputation(COLUMNS, { crossFilters });

describe('useCrossFilters', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    /// Render the hook for a table state and return its latest controller
    function renderCrossFilters(dispatch: (action: ComputationAction) => void) {
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

    it('sets histogram filters of ordinal columns only', () => {
        const { dispatch, ofType } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        hook.render(tableState());
        hook.current.controller!.histogramFilter({} as TableAggregation, 1, {} as never, [1, 2]);
        hook.current.controller!.histogramFilter({} as TableAggregation, 2, {} as never, [1, 2]);

        const set = ofType(SET_CROSS_FILTERS);
        expect(set).toHaveLength(1);
        const [tableId, filters] = set[0].value as [number, CrossFilters];
        expect(tableId).toBe(1);
        expect(filters.containsHistogramFilter(1, [1, 2])).toBe(true);
    });

    it('toggles most frequent value filters of string columns', () => {
        const { dispatch, ofType } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        const selected = new CrossFilters();
        selected.addMostFrequentValueFilter(2, NAME, 7);
        hook.render(tableState(selected));

        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 2, {} as never, 7);
        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 2, {} as never, 8);
        hook.current.controller!.mostFrequentValueFilter({} as TableAggregation, 1, {} as never, 8);
        const filters = ofType(SET_CROSS_FILTERS).map(action => (action.value as [number, CrossFilters])[1]);
        expect(filters).toHaveLength(2);
        expect(filters[0].containsMostFrequentValueFilter(2, 7)).toBe(false);
        expect(filters[1].containsMostFrequentValueFilter(2, 8)).toBe(true);
    });

    it('runs one filter task at a time and only the latest pending selection', async () => {
        const { dispatch, scheduled } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        const brushed = (brush: [number, number]) => {
            const filters = new CrossFilters();
            filters.addHistogramFilter(1, SCORE, brush);
            return tableState(filters);
        };
        hook.render(brushed([0, 1]));
        hook.render(brushed([0, 2]));
        hook.render(brushed([0, 3]));
        expect(scheduled(TABLE_FILTERING_TASK)).toHaveLength(1);

        scheduled(TABLE_FILTERING_TASK)[0].result.resolve(null);
        await vi.waitFor(() => expect(scheduled(TABLE_FILTERING_TASK)).toHaveLength(2));
        const latest = scheduled(TABLE_FILTERING_TASK)[1].value as { filters: { value: unknown }[] };
        expect(latest.filters.map(filter => filter.value)).toContain(3);
    });

    it('filters again only when the filter table or the running task has other filters', () => {
        const brushed = new CrossFilters();
        brushed.addHistogramFilter(1, SCORE, [1, 2]);
        const transforms = brushed.createFilterTransforms();
        const base = tableState(brushed);
        const progress = (status: TaskStatus) => ({ status, startedAt: new Date(), completedAt: null, failedAt: null, failedWithError: null });
        /// The state after filtering with the filters, with the task in the status
        const filteredWith = (filters: ScalarFilter[], status: TaskStatus, filterTable = true): TableComputationState => ({
            ...base,
            filterTable: filterTable ? { version: base.version, dataTable: tableFromArrays({ rownum: Int32Array.from([0]) }) } as unknown as FilterTable : null,
            tasks: {
                ...base.tasks,
                filteringTask: { tableId: 1, tableVersion: base.version, filters, progress: progress(status) } as unknown as TableComputationState['tasks']['filteringTask'],
            },
        });
        const scheduledFor = (state: TableComputationState) => {
            const { dispatch, scheduled } = recordingDispatch();
            const hook = renderCrossFilters(dispatch);
            hook.render(state);
            const tasks = scheduled(TABLE_FILTERING_TASK);
            root!.unmount();
            root = null;
            return tasks;
        };

        // The filter table has the filters of the selection
        expect(scheduledFor(filteredWith(transforms, TaskStatus.TASK_SUCCEEDED))).toHaveLength(0);
        // A filter table of fewer filters, of another bin or another field is outdated
        expect(scheduledFor(filteredWith(transforms.slice(0, 1), TaskStatus.TASK_SUCCEEDED))).toHaveLength(1);
        expect(scheduledFor(filteredWith([transforms[0], { ...transforms[1], value: 3 }], TaskStatus.TASK_SUCCEEDED))).toHaveLength(1);
        expect(scheduledFor(filteredWith([{ ...transforms[0], fieldName: 'other_bin' }, transforms[1]], TaskStatus.TASK_SUCCEEDED))).toHaveLength(1);
        expect(scheduledFor(filteredWith([{ ...transforms[0], op: '>' }, transforms[1]], TaskStatus.TASK_SUCCEEDED))).toHaveLength(1);
        // A running task of the selection is awaited, a running task of other filters is not
        expect(scheduledFor(filteredWith(transforms, TaskStatus.TASK_RUNNING, false))).toHaveLength(0);
        expect(scheduledFor(filteredWith(transforms.slice(1), TaskStatus.TASK_RUNNING, false))).toHaveLength(1);
        // Clearing the selection drops the filter table
        expect(scheduledFor({ ...filteredWith(transforms, TaskStatus.TASK_SUCCEEDED), crossFilters: new CrossFilters() })).toHaveLength(1);
        // Without a selection and a filter table there is nothing to filter
        expect(scheduledFor({ ...base, crossFilters: new CrossFilters() })).toHaveLength(0);
    });

    it('schedules a filtered column aggregation once with the selected row count', () => {
        const { dispatch, scheduled } = recordingDispatch();
        const hook = renderCrossFilters(dispatch);
        const state: TableComputationState = {
            ...tableState(),
            tableAggregation: {} as TableAggregation,
            filterTable: { dataTable: tableFromArrays({ rownum: Int32Array.from([0, 1, 2]) }), version: tableState().version } as unknown as FilterTable,
            dataSearchTable: { dataTable: tableFromArrays({ row_idx: Int32Array.from([1, 2, 5]) }), requestId: 3 } as unknown as DataSearchTable,
            columnAggregates: [null, {} as ColumnAggregationVariant, null],
        };
        hook.render(state);
        hook.current.controller!.requestFilteredColumnAggregation(1);
        hook.current.controller!.requestFilteredColumnAggregation(1);
        // Columns without an unfiltered aggregate are skipped
        hook.current.controller!.requestFilteredColumnAggregation(2);

        const tasks = scheduled(FILTERED_COLUMN_AGGREGATION_TASK);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].value).toMatchObject({ columnId: 1, selectionRowCount: 2 });
    });
});
