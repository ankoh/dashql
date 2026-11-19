import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as d3 from 'd3';
import { act } from '../../testing/react_act.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as styles from './data_table.module.css';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { ArrowTableFormatter } from '@akohn/dashql/platform/compute/arrow_formatter';
import type { ComputationColumnGroup, ComputationTrackedTask, ComputationVersionValue } from '@akohn/dashql';
import {
    type ColumnAggregationVariant,
    LIST_COLUMN,
    ORDINAL_COLUMN,
    ROWNUMBER_COLUMN,
    STRING_COLUMN,
    type TableAggregation,
    TaskStatus,
} from '@akohn/dashql/platform/compute/computation_types';
import { ordinalAggregate, stringAggregate, summaryColumn } from '@akohn/dashql/platform/testing/column_aggregates';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { valueColumn } from '../../testing/computation_mocks.js';
import { createTestRoot } from '../../testing/react_root.js';
import type { DataTableLayout } from './data_table_layout.js';
import { HeaderPlotsCell, type HeaderPlotsCellProps } from './data_table_cell_header_plots.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const NAME_STATS = { countFieldName: '_0_count', distinctCountFieldName: '_0_distinct', minAggregateFieldName: null, maxAggregateFieldName: null };
const SCORE_STATS = { countFieldName: '_1_count', distinctCountFieldName: null, minAggregateFieldName: '_1_min', maxAggregateFieldName: '_1_max' };
const NAME: ComputationColumnGroup = { type: STRING_COLUMN, value: valueColumn('name', 'Utf8', { statsFields: NAME_STATS, valueIdFieldName: 'name_id' }) };
const SCORE: ComputationColumnGroup = { type: ORDINAL_COLUMN, value: valueColumn('score', 'Float64', { inputFieldNullable: false, statsFields: SCORE_STATS, binFieldName: 'score_bin', binCount: 4 }) };
const EMBEDDING: ComputationColumnGroup = { type: LIST_COLUMN, value: valueColumn('embedding', 'List(Float32)') };
/// The row numbers, name, score, the value ids of name (a system column), the embedding and a column without aggregate
const COLUMN_GROUPS: ComputationColumnGroup[] = [{ type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } }, NAME, SCORE, EMBEDDING];
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
        table: stats,
        tableFieldsByName: new Map(stats.schema.fields.map((field, index) => [field.name, index])),
        tableFormatter: new ArrowTableFormatter(stats.schema, stats.batches, new TestLogger()),
        countStarFieldName: '_count_star',
    };
}
const TABLE = tableAggregate();

async function nameAggregate(): Promise<ColumnAggregationVariant> {
    const values = tableFromArrays({ key: ['a', 'b', 'c'], keyId: BigInt64Array.from([1n, 2n, 3n]), count: BigInt64Array.from([5n, 3n, 2n]) });
    return { type: STRING_COLUMN, value: stringAggregate(TABLE, summaryColumn('name', new arrow.Utf8(), { statsFields: NAME_STATS, valueIdFieldName: 'name_id' }), values) };
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
    const score = summaryColumn('score', new arrow.Float64(), { inputFieldNullable: false, statsFields: SCORE_STATS, binFieldName: 'score_bin', binCount: 4 });
    return { type: ORDINAL_COLUMN, value: ordinalAggregate(TABLE, score, bins) };
}

/// A task of a column with its status
function tracked(status: TaskStatus, version: ComputationVersionValue = { data: 1, filter: 1 }): ComputationTrackedTask {
    return { taskId: 1, tableVersion: version, progress: { status, startedAt: 0, completedAt: null, failedAt: null, failedWithError: null } };
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
            columnAggregationTasks: [null, tracked(TaskStatus.TASK_SUCCEEDED), tracked(TaskStatus.TASK_SUCCEEDED), null],
            filteredColumnAggregations: [null, null, null, null],
            filteredColumnAggregationTasks: [null, null, null, null],
            filteredColumnAggregationOutdated: [false, false, false, false],
            tableAggregation: TABLE,
            selectionEpoch: { data: 1, filter: 2 },
            dataSearchRequestId: null,
            crossFilters: [],
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

        const running = await render({ ...props, columnAggregationTasks: [null, tracked(TaskStatus.TASK_RUNNING), null, null] });
        expect(running.classList.contains(styles.plots_progress)).toBe(true);
        expect(running.firstElementChild?.classList.contains(styles.plots_progress_spinner)).toBe(true);

        const failed = await render({ ...props, columnAggregationTasks: [null, tracked(TaskStatus.TASK_FAILED), null, null] });
        expect(failed.textContent).toBe('Failed');

        // A stopped query ends its task cancelled, not failed
        const cancelled = await render({ ...props, columnAggregationTasks: [null, tracked(TaskStatus.TASK_CANCELLED), null, null] });
        expect(cancelled.textContent).toBe('Cancelled');

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

        const filtered = await render({ ...props, columnIndex: 2, crossFilters: [{ kind: 'histogram', column: 2, selection: [1, 3] }] });
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

    it('requests the filtered aggregate again when the selection moves, the runtime computes it once', async () => {
        const props = await succeeded();
        const outdated = [false, true, false, false];
        const request = vi.fn();
        await render({ ...props, filteredColumnAggregationOutdated: outdated, filteredColumnAggregationTasks: [null, tracked(TaskStatus.TASK_RUNNING, props.selectionEpoch), null, null], onRequestFilteredColumnAggregation: request });
        expect(request).toHaveBeenCalledExactlyOnceWith(1);
        await render({ ...props, filteredColumnAggregationOutdated: outdated, selectionEpoch: { data: 1, filter: 3 }, onRequestFilteredColumnAggregation: request });
        expect(request).toHaveBeenCalledTimes(2);
    });
});
