import * as React from 'react';
import * as arrow from 'apache-arrow';
import * as d3 from 'd3';
import { act, flushContinuousUpdates } from '@dashql/browser-test-act';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { ArrowTableFormatter, dataTypeToString } from '../../compute/arrow_formatter.js';
import {
    type ColumnAggregationTask,
    type ColumnAggregationVariant,
    type ColumnGroup,
    ComputationStateVersion,
    ORDINAL_COLUMN,
    type OrdinalColumnAggregation,
    type TableAggregation,
    type WithFilter,
    type WithFilterEpoch,
} from '../../compute/computation_types.js';
import { computeColumnAggregates, computeFilteredColumnAggregates } from '../../compute/tasks/column_aggregation.js';
import { executeReturning, mockDataFrame } from '../../tests/mocks/compute_query.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import { createTestRoot } from '../../tests/react_root.js';
import { COLUMN_SUMMARY_COLORS, COLUMN_SUMMARY_NULL_COLORS } from './data_table_colors.js';
import { HistogramCell, type HistogramFilterCallback } from './histogram_cell.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const TYPE = dataTypeToString(new arrow.Float64());

function scoreColumn(binCount: number, nullable: boolean): ColumnGroup {
    return {
        type: ORDINAL_COLUMN,
        value: {
            inputFieldName: 'score',
            inputFieldType: new arrow.Float64(),
            inputFieldNullable: nullable,
            statsFields: { countFieldName: '_0_count', distinctCountFieldName: null, minAggregateFieldName: '_0_min', maxAggregateFieldName: '_0_max' },
            binFieldName: 'score_bin',
            binCount,
        },
    };
}

/// The table aggregate of a table with `rows` rows and the values of score between 0 and max
function tableAggregate(rows: number, notNull: number, max: number): TableAggregation {
    const stats = tableFromArrays({
        _count_star: BigInt64Array.from([BigInt(rows)]),
        _0_count: BigInt64Array.from([BigInt(notNull)]),
        _0_min: Float64Array.from([0]),
        _0_max: Float64Array.from([max]),
    });
    return {
        dataFrame: mockDataFrame('stats'),
        table: stats,
        tableFieldsByName: new Map(stats.schema.fields.map((field, index) => [field.name, index])),
        tableFormatter: new ArrowTableFormatter(stats.schema, stats.batches, new TestLogger()),
        countStarFieldName: '_count_star',
    };
}

function aggregationTask(table: TableAggregation, column: ColumnGroup): ColumnAggregationTask {
    return {
        tableId: 1,
        tableVersion: new ComputationStateVersion(1, 1),
        columnId: 2,
        columnEntry: column,
        inputDataFrame: mockDataFrame('input'),
        tableAggregate: table,
    };
}

/// The bins of width 10 starting at 0, followed by the bin of the null values
function bins(counts: bigint[]) {
    const binCount = counts.length - 1;
    const ids = Array.from({ length: counts.length }, (_, bin) => bin);
    return tableFromArrays({
        bin: Int32Array.from(ids),
        count: BigInt64Array.from(counts),
        binWidth: Float64Array.from(ids.map(bin => bin < binCount ? 10 : 0)),
        binLowerBound: Float64Array.from(ids.map(bin => bin < binCount ? bin * 10 : 0)),
        binUpperBound: Float64Array.from(ids.map(bin => bin < binCount ? (bin + 1) * 10 : 0)),
    });
}

/// Aggregate the column with the bins the compute query returns
async function aggregate(table: TableAggregation, column: ColumnGroup, values: arrow.Table): Promise<OrdinalColumnAggregation> {
    const result = await computeColumnAggregates(aggregationTask(table, column), new TestLogger(), executeReturning(values).executeQuery);
    expect(result.type).toBe(ORDINAL_COLUMN);
    return result.value as OrdinalColumnAggregation;
}

/// Aggregate the column among the selected rows
async function aggregateFiltered(table: TableAggregation, column: ColumnGroup, values: arrow.Table, selectionRowCount: number): Promise<WithFilterEpoch<ColumnAggregationVariant>> {
    const task: WithFilter<ColumnAggregationTask> = {
        ...aggregationTask(table, column),
        filterTable: null,
        dataSearchTable: null,
        selectionRowCount,
        unfilteredAggregate: {} as ColumnAggregationVariant,
    };
    const result = await computeFilteredColumnAggregates(task, new TestLogger(), executeReturning(values).executeQuery);
    expect(result).not.toBeNull();
    return result!;
}

/// 10 rows: [0, 10) (1), [10, 20) (4), [20, 30) (2), [30, 40) (1), null (2)
const ROWS = tableAggregate(10, 8, 40);
const SCORE = scoreColumn(4, true);
const BINS = () => bins([1n, 4n, 2n, 1n, 2n]);

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

/// The bins of the selection of a histogram filter, the filter keeps the rows with selection[0] <= bin <= selection[1]
function selectedBins(selection: [number, number] | null, binCount: number): number[] {
    if (selection == null) return [];
    return Array.from({ length: binCount }, (_, bin) => bin).filter(bin => selection[0] <= bin && bin <= selection[1]);
}

describe('HistogramCell', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    interface RenderOptions {
        table?: TableAggregation;
        column: OrdinalColumnAggregation;
        filtered?: WithFilterEpoch<ColumnAggregationVariant> | null;
        selection?: [number, number] | null;
        onFilter?: HistogramFilterCallback;
        onBrushingChange?: (brushing: boolean) => void;
    }

    function element(options: RenderOptions, onFilter: HistogramFilterCallback) {
        return (
            <HistogramCell
                className="cell"
                style={{ width: '200px', height: '80px' }}
                tableAggregation={options.table ?? ROWS}
                columnIndex={2}
                columnAggregate={options.column}
                filteredColumnAggregation={options.filtered ?? null}
                selection={options.selection ?? null}
                onFilter={onFilter}
                onBrushingChange={options.onBrushingChange}
            />
        );
    }

    /// Render the cell and wait until it has measured its plot
    async function render(options: RenderOptions) {
        const onFilter = options.onFilter ?? vi.fn();
        root ??= createTestRoot();
        root.render(element(options, onFilter));
        await act(async () => { await nextFrame(); await nextFrame(); });
        return { onFilter, rerender: (next: RenderOptions) => root!.render(element(next, onFilter)) };
    }

    const cell = () => root!.container.querySelector<HTMLDivElement>('.cell')!;
    const header = () => cell().firstElementChild!.firstElementChild!.textContent;
    // The bars, the brush, the axis and the null bar
    const plotGroups = () => cell().querySelectorAll<SVGGElement>('svg > g > g');
    const barRects = () => Array.from(plotGroups()[0].querySelectorAll<SVGRectElement>('rect'));
    const brush = () => plotGroups()[1];
    const overlay = () => brush().querySelector<SVGRectElement>('.overlay')!;
    const brushSelection = () => brush().querySelector<SVGRectElement>('.selection')!;
    const nullBar = () => plotGroups()[3]?.querySelector<SVGRectElement>('rect') ?? null;
    const labels = () => Array.from(cell().querySelectorAll('span')).map(span => span.textContent);

    function centerY(rect: Element) {
        const bounds = rect.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
    }
    /// Move the pointer and wait until React rendered the update, it renders continuous events in a later task
    async function pointer(target: Element, type: 'pointerover' | 'pointermove' | 'pointerout', clientX: number) {
        await act(async () => {
            target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY: centerY(overlay()) }));
            await flushContinuousUpdates();
        });
    }
    async function hoverBin(bin: number) {
        const bounds = barRects()[bin].getBoundingClientRect();
        await pointer(overlay(), 'pointermove', bounds.left + bounds.width / 2);
    }
    /// Brush with the mouse, d3 listens for the moves and the release on the window
    function mouse(type: 'mousedown' | 'mousemove' | 'mouseup', clientX: number) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX, clientY: centerY(overlay()) });
        act(() => { (type === 'mousedown' ? overlay() : document).dispatchEvent(event); });
    }

    it('shows a bar per bin with heights proportional to the counts', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        await render({ column });

        expect(header()).toBe(TYPE);
        const bars = barRects();
        expect(bars).toHaveLength(4);
        expect(bars.every(bar => bar.getAttribute('fill') === COLUMN_SUMMARY_COLORS.totalBar)).toBe(true);
        const heights = bars.map(bar => bar.getBoundingClientRect().height);
        const unit = heights[1] / 4;
        expect(heights[0]).toBeCloseTo(unit, 3);
        expect(heights[2]).toBeCloseTo(2 * unit, 3);
        expect(heights[3]).toBeCloseTo(unit, 3);
        // The bars stand on the same baseline, left to right
        const bottoms = bars.map(bar => bar.getBoundingClientRect().bottom);
        bottoms.forEach(bottom => expect(bottom).toBeCloseTo(bottoms[0], 3));
        const lefts = bars.map(bar => bar.getBoundingClientRect().left);
        expect([...lefts].sort((l, r) => l - r)).toEqual(lefts);

        // The axis shows the lower bounds of the first and the last bin, the null bar has its symbol
        expect(labels()).toEqual(['0', '30', '∅']);
        // The null bar shares the scale of the bins
        expect(nullBar()!.getAttribute('fill')).toBe(COLUMN_SUMMARY_NULL_COLORS.totalBar);
        expect(nullBar()!.getBoundingClientRect().height).toBeCloseTo(2 * unit, 3);
        expect(nullBar()!.getBoundingClientRect().left).toBeGreaterThan(bars[3].getBoundingClientRect().right);
    });

    it('describes the bin under the pointer', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        await render({ column });

        await hoverBin(1);
        expect(header()).toBe('4 rows (40%)');
        expect(labels()).toEqual(['10', '∅']);
        // The focused bar is drawn over the bar of the bin
        const focused = barRects()[4];
        expect(focused.getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.totalBarFocused);
        expect(focused.getAttribute('x')).toBe(barRects()[1].getAttribute('x'));
        expect(cell().style.zIndex).toBe('100');

        await hoverBin(3);
        expect(header()).toBe('1 row (10%)');
        expect(labels()).toEqual(['30', '∅']);

        await pointer(overlay(), 'pointerout', 0);
        expect(header()).toBe(TYPE);
        expect(labels()).toEqual(['0', '30', '∅']);
        expect(barRects()).toHaveLength(4);
        expect(cell().style.zIndex).toBe('');
    });

    it('describes the bins at the edges of their bars', async () => {
        // 16 bins with one row each
        const binCount = 16;
        const table = tableAggregate(binCount, binCount, 160);
        const column = await aggregate(table, scoreColumn(binCount, false), bins([...Array(binCount).fill(1n), 0n]));
        await render({ column, table });

        const bars = barRects();
        expect(bars).toHaveLength(binCount);
        for (const [bin, bar] of bars.entries()) {
            const bounds = bar.getBoundingClientRect();
            for (const clientX of [bounds.left + 0.5, bounds.left + bounds.width / 2, bounds.right - 0.5]) {
                await pointer(overlay(), 'pointermove', clientX);
                expect({ bin, clientX, label: labels() }).toEqual({ bin, clientX, label: [`${bin * 10}`] });
            }
        }
    });

    it('describes the bins under the pointer while a brush starts at the left end', async () => {
        const binCount = 16;
        const table = tableAggregate(binCount, binCount, 160);
        const column = await aggregate(table, scoreColumn(binCount, false), bins([...Array(binCount).fill(1n), 0n]));
        await render({ column, table });

        // The handles of the brush reach out of the plot on the left
        const bars = barRects();
        mouse('mousedown', overlay().getBoundingClientRect().left);
        mouse('mousemove', bars[5].getBoundingClientRect().right + 0.5);
        mouse('mouseup', bars[5].getBoundingClientRect().right + 0.5);
        expect(brush().getBoundingClientRect().left).toBeLessThan(overlay().getBoundingClientRect().left);

        for (const bin of [3, 8]) {
            const bounds = bars[bin].getBoundingClientRect();
            for (const clientX of [bounds.left + 0.5, bounds.right - 0.5]) {
                await pointer(overlay(), 'pointermove', clientX);
                expect({ bin, clientX, label: labels() }).toEqual({ bin, clientX, label: [`${bin * 10}`] });
            }
        }
    });

    it('describes the bins along the axis', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        await render({ column });

        const axis = plotGroups()[2].querySelector('rect')!;
        const bounds = barRects()[2].getBoundingClientRect();
        await pointer(axis, 'pointermove', bounds.left + bounds.width / 2);
        expect(header()).toBe('2 rows (20%)');
        expect(labels()).toEqual(['20', '∅']);
        await pointer(axis, 'pointerout', 0);
        expect(header()).toBe(TYPE);
    });

    it('describes the null values under the pointer', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        await render({ column });

        const bounds = nullBar()!.getBoundingClientRect();
        await pointer(nullBar()!, 'pointerover', bounds.left + bounds.width / 2);
        expect(header()).toBe('2 rows (20%)');
        expect(nullBar()!.getAttribute('fill')).toBe(COLUMN_SUMMARY_NULL_COLORS.totalBarFocused);
        // The symbol of the null bar is highlighted, the axis labels stay
        expect(labels()).toEqual(['0', '30', '∅']);
        const symbol = Array.from(cell().querySelectorAll('span')).find(span => span.textContent === '∅')!;
        expect(symbol.className).not.toBe('');

        await pointer(nullBar()!, 'pointerout', bounds.left + bounds.width / 2);
        expect(header()).toBe(TYPE);
        expect(nullBar()!.getAttribute('fill')).toBe(COLUMN_SUMMARY_NULL_COLORS.totalBar);
        const plain = Array.from(cell().querySelectorAll('span')).find(span => span.textContent === '∅')!;
        expect(plain.className).toBe('');
    });

    it('leaves out the null bar of columns without nulls', async () => {
        const table = tableAggregate(8, 8, 40);
        const column = await aggregate(table, scoreColumn(4, false), bins([1n, 4n, 2n, 1n, 0n]));
        await render({ column, table });

        expect(plotGroups()).toHaveLength(3);
        expect(labels()).toEqual(['0', '30']);
        // Without the null bar, the bins take the whole width
        const overlayBounds = overlay().getBoundingClientRect();
        expect(barRects()[3].getBoundingClientRect().right).toBeGreaterThan(overlayBounds.right - 10);
    });

    it('filters by the bins of the brushed bars', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const onBrushingChange = vi.fn();
        const { onFilter } = await render({ column, onBrushingChange });

        // Brush from the gap left of bin 1 to the gap right of bin 2
        const bars = barRects();
        mouse('mousedown', bars[1].getBoundingClientRect().left - 1);
        expect(onBrushingChange).toHaveBeenLastCalledWith(true);
        mouse('mousemove', bars[2].getBoundingClientRect().right + 1);
        mouse('mouseup', bars[2].getBoundingClientRect().right + 1);
        expect(onBrushingChange).toHaveBeenLastCalledWith(false);

        expect(onFilter).toHaveBeenCalledOnce();
        const [table, columnIndex, aggregate_, selection] = vi.mocked(onFilter).mock.calls[0];
        expect(table).toBe(ROWS);
        expect(columnIndex).toBe(2);
        expect(aggregate_).toBe(column);
        expect(selectedBins(selection, 4)).toEqual([1, 2]);
    });

    it('reports the selection while brushing once it settles', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const { onFilter } = await render({ column });

        const bars = barRects();
        mouse('mousedown', bars[0].getBoundingClientRect().left - 1);
        mouse('mousemove', bars[0].getBoundingClientRect().right + 1);
        expect(onFilter).not.toHaveBeenCalled();
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
        expect(onFilter).toHaveBeenCalledOnce();
        expect(selectedBins(vi.mocked(onFilter).mock.calls[0][3], 4)).toEqual([0]);

        mouse('mousemove', bars[3].getBoundingClientRect().right + 1);
        mouse('mouseup', bars[3].getBoundingClientRect().right + 1);
        expect(onFilter).toHaveBeenCalledTimes(2);
        expect(selectedBins(vi.mocked(onFilter).mock.calls[1][3], 4)).toEqual([0, 1, 2, 3]);
    });

    it('clears the filter when clicking the plot without brushing', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const { onFilter } = await render({ column });

        const x = barRects()[1].getBoundingClientRect().left + 2;
        mouse('mousedown', x);
        mouse('mouseup', x);
        expect(onFilter).toHaveBeenCalledOnce();
        expect(onFilter).toHaveBeenCalledWith(ROWS, 2, column, null);
        // The click does not reach the cell
        act(() => { overlay().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(onFilter).toHaveBeenCalledOnce();
    });

    it('shows the brush of the selected bins', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const { onFilter } = await render({ column, selection: [1, 3] });

        // The selection spans the bins 1 and 2, from the start of bin 1 to the start of bin 3
        const bars = barRects();
        // The bars and the brush share the coordinates of the plot, bounding boxes would include the stroke of the brush
        const x = (rect: SVGRectElement) => Number(rect.getAttribute('x'));
        const width = (rect: SVGRectElement) => Number(rect.getAttribute('width'));
        expect(x(brushSelection())).toBeCloseTo(x(bars[1]), 3);
        expect(x(brushSelection()) + width(brushSelection())).toBeCloseTo(x(bars[3]), 3);
        expect(d3.brushSelection(brush())).not.toBeNull();
        // Showing the selection does not report it back
        expect(onFilter).not.toHaveBeenCalled();
    });

    it('keeps the filter it reported when it gets it back as selection', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const options: RenderOptions = { column };
        const { onFilter, rerender } = await render(options);

        const bars = barRects();
        mouse('mousedown', bars[1].getBoundingClientRect().left - 1);
        mouse('mousemove', bars[2].getBoundingClientRect().right + 1);
        mouse('mouseup', bars[2].getBoundingClientRect().right + 1);
        const selection = vi.mocked(onFilter).mock.calls[0][3]!;
        const brushed = brushSelection().getBoundingClientRect();

        rerender({ ...options, selection });
        const shown = brushSelection().getBoundingClientRect();
        expect(shown.left).toBeCloseTo(brushed.left, 3);
        expect(shown.right).toBeCloseTo(brushed.right, 3);
        expect(onFilter).toHaveBeenCalledOnce();
    });

    it('clears the brush when clicking the cell', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        const { onFilter } = await render({ column, selection: [1, 3] });

        act(() => { cell().firstElementChild!.firstElementChild!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(onFilter).toHaveBeenCalledOnce();
        expect(onFilter).toHaveBeenCalledWith(ROWS, 2, column, null);
        expect(d3.brushSelection(brush())).toBeNull();
        expect(brushSelection().style.display).toBe('none');
    });

    it('shows the bins of the selected rows', async () => {
        const column = await aggregate(ROWS, SCORE, BINS());
        // 4 selected rows: [10, 20) (2), [20, 30) (1), null (1)
        const filtered = await aggregateFiltered(ROWS, SCORE, bins([0n, 2n, 1n, 0n, 1n]), 4);
        await render({ column, filtered });

        // The bars of all rows fade behind the bars of the selected rows
        const rects = barRects();
        expect(rects).toHaveLength(8);
        expect(rects.slice(0, 4).every(rect => rect.getAttribute('fill') === COLUMN_SUMMARY_COLORS.totalBarWithFilter)).toBe(true);
        expect(rects.slice(4).every(rect => rect.getAttribute('fill') === COLUMN_SUMMARY_COLORS.filteredBar)).toBe(true);
        const heights = rects.map(rect => rect.getBoundingClientRect().height);
        // Bin 1: 2 of 4 rows, bin 2: 1 of 2 rows
        expect(heights[5]).toBeCloseTo(heights[1] / 2, 3);
        expect(heights[6]).toBeCloseTo(heights[2] / 2, 3);
        expect(heights[4]).toBe(0);

        await hoverBin(1);
        expect(header()).toBe('2 rows (50%)');
        expect(barRects()[barRects().length - 1].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.filteredBarFocused);
        await hoverBin(3);
        expect(header()).toBe('0 rows (0%)');

        // The null bar shows the selected nulls
        await pointer(overlay(), 'pointerout', 0);
        const nullRects = plotGroups()[3].querySelectorAll(':scope > rect');
        expect(nullRects).toHaveLength(2);
        expect(nullRects[0].getAttribute('fill')).toBe(COLUMN_SUMMARY_NULL_COLORS.totalBarWithFilter);
        expect(nullRects[1].getBoundingClientRect().height).toBeCloseTo(nullRects[0].getBoundingClientRect().height / 2, 3);
        await pointer(nullBar()!, 'pointerover', nullBar()!.getBoundingClientRect().left + 1);
        expect(header()).toBe('1 row (25%)');
    });
});
