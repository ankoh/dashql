import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as d3 from 'd3';
import { act } from '@dashql/browser-test-act';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as styles from './data_table.module.css';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { ArrowTableFormatter } from '../../compute/arrow_formatter.js';
import {
    type ColumnAggregationTask,
    type ColumnAggregationVariant,
    type ColumnGroup,
    ComputationStateVersion,
    LIST_COLUMN,
    ORDINAL_COLUMN,
    ROWNUMBER_COLUMN,
    STRING_COLUMN,
    type TableAggregation,
    TaskStatus,
    type WithFilter,
    type WithProgress,
} from '../../compute/computation_types.js';
import { computeColumnAggregates } from '../../compute/tasks/column_aggregation.js';
import { CrossFilters } from '../../compute/cross_filters.js';
import { executeReturning, mockDataFrame } from '../../tests/mocks/compute_query.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import { createTestRoot } from '../../tests/react_root.js';
import type { DataTableLayout } from './data_table_layout.js';
import { HeaderPlotsCell, type HeaderPlotsCellProps } from './data_table_cell_header_plots.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const NAME: ColumnGroup = {
    type: STRING_COLUMN,
    value: {
        inputFieldName: 'name',
        inputFieldType: new arrow.Utf8(),
        inputFieldNullable: true,
        statsFields: { countFieldName: '_0_count', distinctCountFieldName: '_0_distinct', minAggregateFieldName: null, maxAggregateFieldName: null },
        valueIdFieldName: 'name_id',
    },
};
const SCORE: ColumnGroup = {
    type: ORDINAL_COLUMN,
    value: {
        inputFieldName: 'score',
        inputFieldType: new arrow.Float64(),
        inputFieldNullable: false,
        statsFields: { countFieldName: '_1_count', distinctCountFieldName: null, minAggregateFieldName: '_1_min', maxAggregateFieldName: '_1_max' },
        binFieldName: 'score_bin',
        binCount: 4,
    },
};
const EMBEDDING: ColumnGroup = {
    type: LIST_COLUMN,
    value: {
        inputFieldName: 'embedding',
        inputFieldType: new arrow.List(new arrow.Field('item', new arrow.Float32())),
        inputFieldNullable: true,
        statsFields: null,
        valueIdFieldName: null,
    },
};
/// The row numbers, name, score, the value ids of name (a system column), the embedding and a column without aggregate
const COLUMN_GROUPS: ColumnGroup[] = [{ type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } }, NAME, SCORE, EMBEDDING];
const LAYOUT: DataTableLayout = {
    columnCount: 6,
    arrowFieldByColumnIndex: Uint32Array.from([0, 1, 2, 3, 4, 5]),
    columnXOffsets: Float64Array.from([0, 48, 248, 448, 648, 848, 1048]),
    // The aggregates of name and score, the embedding and the last column have none
    columnAggregateByColumnIndex: Int32Array.from([-1, 1, 2, 1, -1, -1]),
    columnGroupByColumnIndex: Uint32Array.from([0, 1, 2, 1, 3, 3]),
    isSystemColumn: Uint8Array.from([1, 0, 0, 1, 0, 1]),
    isTextColumn: Uint8Array.from([0, 1, 0, 0, 0, 0]),
    headerRowCount: 2,
};

/// 10 rows with 3 distinct names and scores between 0 and 40
function tableAggregate(): TableAggregation {
    const stats = tableFromArrays({
        _count_star: BigInt64Array.from([10n]),
        _0_count: BigInt64Array.from([10n]),
        _0_distinct: BigInt64Array.from([3n]),
        _1_count: BigInt64Array.from([10n]),
        _1_min: Float64Array.from([0]),
        _1_max: Float64Array.from([40]),
    });
    return {
        dataFrame: mockDataFrame('stats'),
        table: stats,
        tableFieldsByName: new Map(stats.schema.fields.map((field, index) => [field.name, index])),
        tableFormatter: new ArrowTableFormatter(stats.schema, stats.batches, new TestLogger()),
        countStarFieldName: '_count_star',
    };
}
const TABLE = tableAggregate();

function aggregationTask(columnId: number, columnEntry: ColumnGroup): ColumnAggregationTask {
    return {
        tableId: 1,
        tableVersion: new ComputationStateVersion(1, 1),
        columnId,
        columnEntry,
        inputDataFrame: mockDataFrame('input'),
        tableAggregate: TABLE,
    };
}

async function nameAggregate(): Promise<ColumnAggregationVariant> {
    const values = tableFromArrays({ key: ['a', 'b', 'c'], keyId: BigInt64Array.from([1n, 2n, 3n]), count: BigInt64Array.from([5n, 3n, 2n]) });
    return await computeColumnAggregates(aggregationTask(1, NAME), new TestLogger(), executeReturning(values).executeQuery);
}

async function scoreAggregate(): Promise<ColumnAggregationVariant> {
    const ids = [0, 1, 2, 3];
    const bins = tableFromArrays({
        bin: Int32Array.from(ids),
        count: BigInt64Array.from([1n, 4n, 3n, 2n]),
        binWidth: Float64Array.from(ids.map(() => 10)),
        binLowerBound: Float64Array.from(ids.map(bin => bin * 10)),
        binUpperBound: Float64Array.from(ids.map(bin => (bin + 1) * 10)),
    });
    return await computeColumnAggregates(aggregationTask(2, SCORE), new TestLogger(), executeReturning(bins).executeQuery);
}

function progress(status: TaskStatus) {
    return { status, startedAt: new Date(), completedAt: null, failedAt: null, failedWithError: null };
}
function withProgress<T extends object>(task: T, status: TaskStatus): WithProgress<T> {
    return { ...task, progress: progress(status) };
}
function filteredTask(status: TaskStatus, version: ComputationStateVersion, dataSearchRequestId: number | null): WithProgress<WithFilter<ColumnAggregationTask>> {
    return withProgress({
        ...aggregationTask(1, NAME),
        tableVersion: version,
        filterTable: null,
        dataSearchTable: dataSearchRequestId == null ? null : { requestId: dataSearchRequestId } as never,
        selectionRowCount: 0,
        unfilteredAggregate: {} as ColumnAggregationVariant,
    }, status);
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

describe('HeaderPlotsCell', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    /// The props of a visible cell where both aggregates succeeded
    async function succeeded(): Promise<HeaderPlotsCellProps> {
        const name = await nameAggregate();
        const score = await scoreAggregate();
        return {
            columnIndex: 1,
            style: { width: '200px', height: '76px' },
            gridLayout: LAYOUT,
            columnGroups: COLUMN_GROUPS,
            columnAggregations: [null, name, score, null],
            columnAggregationTasks: [null, withProgress(aggregationTask(1, NAME), TaskStatus.TASK_SUCCEEDED), withProgress(aggregationTask(2, SCORE), TaskStatus.TASK_SUCCEEDED), null],
            filteredColumnAggregations: [null, null, null, null],
            filteredColumnAggregationTasks: [null, null, null, null],
            filteredColumnAggregationOutdated: [false, false, false, false],
            tableAggregation: TABLE,
            selectionEpoch: new ComputationStateVersion(1, 2),
            dataSearchRequestId: null,
            crossFilters: new CrossFilters(),
            isVisible: true,
            rightmostVisibleColumn: 5,
            onRequestFilteredColumnAggregation: vi.fn(),
            onHistogramFilter: vi.fn(),
            onBrushingChange: vi.fn(),
            onMostFrequentValueFilter: vi.fn(),
        };
    }

    async function render(props: HeaderPlotsCellProps) {
        root ??= createTestRoot();
        root.render(<HeaderPlotsCell {...props} />);
        await act(async () => { await nextFrame(); await nextFrame(); });
        return root.container.firstElementChild as HTMLElement;
    }

    it('leaves the columns beyond the layout and the hidden columns blank', async () => {
        const props = await succeeded();
        const beyond = await render({ ...props, columnIndex: 6 });
        expect(beyond.className).toBe('');
        expect(beyond.childElementCount).toBe(0);

        const hidden = await render({ ...props, isVisible: false });
        expect(hidden.className).toBe('');
        expect(hidden.childElementCount).toBe(0);
    });

    it('shows the corner cell above the row numbers', async () => {
        const props = await succeeded();
        const corner = await render({ ...props, columnIndex: 0 });
        expect(corner.className).toBe(styles.plots_corner_cell);
    });

    it('marks list columns as columns without summary and leaves their system columns empty', async () => {
        const props = await succeeded();
        const list = await render({ ...props, columnIndex: 4 });
        expect(list.classList.contains(styles.plots_no_summary_cell)).toBe(true);
        expect(list.title).toBe('No column summary');
        expect(list.textContent).toBe('No summary');
        expect(list.classList.contains(styles.plots_cell_rightmost)).toBe(false);

        const system = await render({ ...props, columnIndex: 5 });
        expect(system.classList.contains(styles.plots_empty_cell)).toBe(true);
        expect(system.classList.contains(styles.plots_cell_rightmost)).toBe(true);
        expect(system.textContent).toBe('');
    });

    it('shows the state of the aggregation of a column', async () => {
        const props = await succeeded();
        const missingTable = await render({ ...props, tableAggregation: null });
        expect(missingTable.textContent).toBe('Table summary is null');

        const running = await render({ ...props, columnAggregationTasks: [null, withProgress(aggregationTask(1, NAME), TaskStatus.TASK_RUNNING), null, null] });
        expect(running.classList.contains(styles.plots_progress)).toBe(true);
        expect(running.firstElementChild?.classList.contains(styles.plots_progress_spinner)).toBe(true);

        const failed = await render({ ...props, columnAggregationTasks: [null, withProgress(aggregationTask(1, NAME), TaskStatus.TASK_FAILED), null, null] });
        expect(failed.textContent).toBe('Failed');

        // An aggregate without a task shows nothing
        const unscheduled = await render({ ...props, columnAggregationTasks: [null, null, null, null] });
        expect(unscheduled.className).toBe(styles.plots_cell);
        expect(unscheduled.childElementCount).toBe(0);
    });

    it('shows the most frequent values of text columns and reports their filter', async () => {
        const props = await succeeded();
        const cell = await render(props);
        expect(cell.classList.contains(styles.plots_cell)).toBe(true);
        expect(cell.querySelector('svg')).not.toBeNull();
        expect(cell.textContent).toContain('Text');

        // Clicking the first bar filters by the value a
        const bar = cell.querySelector<SVGRectElement>('svg > g > g > rect[y]')!;
        const target = cell.querySelectorAll<SVGGElement>('svg > g')[2].querySelector('rect')!;
        const bounds = bar.getBoundingClientRect();
        act(() => {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
        });
        await act(async () => { await nextFrame(); });
        expect(props.onMostFrequentValueFilter).toHaveBeenCalledWith(TABLE, 1, props.columnAggregations[1]!.value, 1);
    });

    it('shows the histogram of ordinal columns with the brush of the cross filter', async () => {
        const props = await succeeded();
        const unfiltered = await render({ ...props, columnIndex: 2 });
        const brush = () => unfiltered.querySelectorAll<SVGGElement>('svg > g > g')[1];
        expect(unfiltered.querySelector('svg')).not.toBeNull();
        expect(d3.brushSelection(brush())).toBeNull();

        const crossFilters = new CrossFilters();
        crossFilters.addHistogramFilter(2, SCORE.value as never, [1, 3]);
        const filtered = await render({ ...props, columnIndex: 2, crossFilters });
        expect(filtered.querySelector('svg')).not.toBeNull();
        expect(d3.brushSelection(brush())).not.toBeNull();
        // Showing the selection does not report it back
        expect(props.onHistogramFilter).not.toHaveBeenCalled();
    });

    it('marks the rightmost visible column', async () => {
        const props = await succeeded();
        const cell = await render({ ...props, rightmostVisibleColumn: 1 });
        expect(cell.classList.contains(styles.plots_cell_rightmost)).toBe(true);
    });

    it('requests the filtered aggregate of a visible column once it is outdated', async () => {
        const props = await succeeded();
        const request = vi.fn();
        const outdated = [false, true, false, false];
        await render({ ...props, onRequestFilteredColumnAggregation: request });
        expect(request).not.toHaveBeenCalled();

        // Hidden columns wait until they are visible
        await render({ ...props, isVisible: false, filteredColumnAggregationOutdated: outdated, onRequestFilteredColumnAggregation: request });
        expect(request).not.toHaveBeenCalled();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, onRequestFilteredColumnAggregation: request });
        expect(request).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('does not request a filtered aggregate that is already running for the selection', async () => {
        const props = await succeeded();
        const outdated = [false, true, false, false];
        const running = (version: ComputationStateVersion, dataSearchRequestId: number | null) => [null, filteredTask(TaskStatus.TASK_RUNNING, version, dataSearchRequestId), null, null];

        const upToDate = vi.fn();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, filteredColumnAggregationTasks: running(props.selectionEpoch, 4), dataSearchRequestId: 4, onRequestFilteredColumnAggregation: upToDate });
        expect(upToDate).not.toHaveBeenCalled();
        root!.unmount();
        root = null;

        // A task of an older selection or of another data search does not count
        const olderSelection = vi.fn();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, filteredColumnAggregationTasks: running(new ComputationStateVersion(1, 1), null), onRequestFilteredColumnAggregation: olderSelection });
        expect(olderSelection).toHaveBeenCalledExactlyOnceWith(1);
        root!.unmount();
        root = null;

        const otherSearch = vi.fn();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, filteredColumnAggregationTasks: running(props.selectionEpoch, 3), dataSearchRequestId: 4, onRequestFilteredColumnAggregation: otherSearch });
        expect(otherSearch).toHaveBeenCalledExactlyOnceWith(1);
        root!.unmount();
        root = null;

        const finished = vi.fn();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, filteredColumnAggregationTasks: [null, filteredTask(TaskStatus.TASK_SUCCEEDED, props.selectionEpoch, null), null, null], onRequestFilteredColumnAggregation: finished });
        expect(finished).toHaveBeenCalledExactlyOnceWith(1);
    });
});
