import * as React from 'react';
import * as arrow from 'apache-arrow';
import { act, flushContinuousUpdates } from '@dashql/browser-test-act';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { ArrowTableFormatter } from '../../compute/arrow_formatter.js';
import {
    type ColumnAggregationTask,
    type ColumnAggregationVariant,
    type ColumnGroup,
    ComputationStateVersion,
    STRING_COLUMN,
    type StringColumnAggregation,
    type TableAggregation,
    type WithFilter,
    type WithFilterEpoch,
} from '../../compute/computation_types.js';
import { computeColumnAggregates, computeFilteredColumnAggregates } from '../../compute/tasks/column_aggregation.js';
import { executeReturning, mockDataFrame } from '../../tests/mocks/compute_query.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import { createTestRoot } from '../../tests/react_root.js';
import { COLUMN_SUMMARY_COLORS, COLUMN_SUMMARY_NULL_COLORS } from './data_table_colors.js';
import { MostFrequentCell, type MostFrequentValueFilterCallback } from './mostfrequent_cell.js';

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

/// The table aggregate of a table with `rows` rows, `notNull` values and `distinct` distinct values in the column name
function tableAggregate(rows: number, notNull: number, distinct: number): TableAggregation {
    const stats = tableFromArrays({
        _count_star: BigInt64Array.from([BigInt(rows)]),
        _0_count: BigInt64Array.from([BigInt(notNull)]),
        _0_distinct: BigInt64Array.from([BigInt(distinct)]),
    });
    return {
        dataFrame: mockDataFrame('stats'),
        table: stats,
        tableFieldsByName: new Map(stats.schema.fields.map((field, index) => [field.name, index])),
        tableFormatter: new ArrowTableFormatter(stats.schema, stats.batches, new TestLogger()),
        countStarFieldName: '_count_star',
    };
}

function aggregationTask(table: TableAggregation): ColumnAggregationTask {
    return {
        tableId: 1,
        tableVersion: new ComputationStateVersion(1, 1),
        columnId: 3,
        columnEntry: NAME,
        inputDataFrame: mockDataFrame('input'),
        tableAggregate: table,
    };
}

/// The frequent values of the column, most frequent first
function frequentValues(keys: (string | null)[], keyIds: bigint[], counts: bigint[]) {
    return tableFromArrays({
        key: keys,
        keyId: BigInt64Array.from(keyIds),
        count: BigInt64Array.from(counts),
    });
}

/// Aggregate the column with the frequent values the compute query returns
async function aggregate(table: TableAggregation, values: arrow.Table): Promise<StringColumnAggregation> {
    const result = await computeColumnAggregates(aggregationTask(table), new TestLogger(), executeReturning(values).executeQuery);
    expect(result.type).toBe(STRING_COLUMN);
    return result.value as StringColumnAggregation;
}

/// Aggregate the column among the selected rows
async function aggregateFiltered(table: TableAggregation, values: arrow.Table, selectionRowCount: number): Promise<WithFilterEpoch<ColumnAggregationVariant>> {
    const task: WithFilter<ColumnAggregationTask> = {
        ...aggregationTask(table),
        filterTable: null,
        dataSearchTable: null,
        selectionRowCount,
        unfilteredAggregate: {} as ColumnAggregationVariant,
    };
    const result = await computeFilteredColumnAggregates(task, new TestLogger(), executeReturning(values).executeQuery);
    expect(result).not.toBeNull();
    return result!;
}

/// 10 rows: a (4), b (2), null (2), c (2)
const ROWS = tableAggregate(10, 8, 3);
const VALUES = () => frequentValues(['a', 'b', null, 'c'], [1n, 2n, 4n, 3n], [4n, 2n, 2n, 2n]);

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

describe('MostFrequentCell', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    interface RenderOptions {
        table?: TableAggregation;
        column: StringColumnAggregation;
        filtered?: WithFilterEpoch<ColumnAggregationVariant> | null;
        onFilter?: MostFrequentValueFilterCallback;
    }

    /// Render the cell and wait until it has measured its plot
    async function render(options: RenderOptions) {
        const onFilter = options.onFilter ?? vi.fn();
        const element = (
            <MostFrequentCell
                className="cell"
                style={{ width: '200px', height: '80px' }}
                tableAggregation={options.table ?? ROWS}
                columnIndex={3}
                columnAggregate={options.column}
                filteredColumnAggregation={options.filtered ?? null}
                onFilter={onFilter}
            />
        );
        root ??= createTestRoot();
        root.render(element);
        await act(async () => { await nextFrame(); await nextFrame(); });
        return { onFilter, rerender: (next: React.ReactElement) => root!.render(next) };
    }

    const cell = () => root!.container.querySelector<HTMLDivElement>('.cell')!;
    const header = () => cell().firstElementChild!.firstElementChild!.textContent;
    const svg = () => cell().querySelector('svg')!;
    // The groups of the bars, the outline, and the pointer target
    const plotGroups = () => svg().querySelectorAll<SVGGElement>(':scope > g');
    /// The background rects of the bars, one per frequent value
    // The rect of the more button has no y attribute
    const totalBars = () => Array.from(plotGroups()[0].querySelectorAll<SVGRectElement>(':scope > g > rect:first-child[y]'));
    /// The fill rects of the bars that show the selected rows
    const filteredBars = (bar: number) => plotGroups()[0].querySelectorAll<SVGGElement>(':scope > g')[bar].querySelectorAll('rect');
    const pointerTarget = () => plotGroups()[2].querySelector('rect')!;
    const axisLabels = () => Array.from(cell().querySelectorAll('span'))
        .map(span => span.textContent)
        .filter(text => text !== 'all distinct');

    function center(rect: Element) {
        const bounds = rect.getBoundingClientRect();
        return { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 };
    }
    /// Move the pointer and wait until React rendered the update, it renders continuous events in a later task
    async function pointer(type: 'pointerover' | 'pointermove' | 'pointerout', at: { clientX: number; clientY: number }) {
        await act(async () => {
            pointerTarget().dispatchEvent(new PointerEvent(type, { bubbles: true, ...at }));
            await flushContinuousUpdates();
        });
    }
    function click(target: Element, at: { clientX: number; clientY: number } = center(target)) {
        act(() => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...at })); });
    }
    const hoverBar = (bar: number) => pointer('pointermove', center(totalBars()[bar]));

    it('shows a bar per frequent value with widths proportional to the counts', async () => {
        const column = await aggregate(ROWS, VALUES());
        await render({ column });

        expect(header()).toBe('Text');
        const widths = totalBars().map(bar => Number(bar.getAttribute('width')));
        expect(widths).toHaveLength(4);
        // a (4 rows) is twice as wide as the others (2 rows), each bar loses the same padding
        expect(widths[0]).toBeCloseTo(2 * widths[1] + 1, 3);
        expect(widths[1]).toBeCloseTo(widths[2], 3);
        expect(widths[2]).toBeCloseTo(widths[3], 3);
        // The bars follow each other in the order of the frequent values
        const lefts = totalBars().map(bar => bar.getBoundingClientRect().left);
        expect([...lefts].sort((l, r) => l - r)).toEqual(lefts);
        // The axis shows the shares of the most and the least frequent value
        expect(axisLabels()).toEqual(['40%', '20%']);
        expect(cell().textContent).not.toContain('all distinct');
    });

    it('marks the null value with its own color and stripes', async () => {
        const column = await aggregate(ROWS, VALUES());
        await render({ column });

        const fills = totalBars().map(bar => bar.getAttribute('fill'));
        expect(fills).toEqual([
            COLUMN_SUMMARY_COLORS.totalBar,
            COLUMN_SUMMARY_COLORS.totalBar,
            COLUMN_SUMMARY_NULL_COLORS.totalBar,
            COLUMN_SUMMARY_COLORS.totalBar,
        ]);
        // The stripes overlay the null bar
        const stripes = Array.from(plotGroups()[0].querySelectorAll<SVGRectElement>(':scope > rect'))
            .filter(rect => rect.getAttribute('fill')?.startsWith('url(#'));
        expect(stripes).toHaveLength(1);
        expect(stripes[0].getAttribute('x')).toBe(totalBars()[2].getAttribute('x'));
        expect(stripes[0].getAttribute('width')).toBe(totalBars()[2].getAttribute('width'));
    });

    it('describes the value under the pointer', async () => {
        const column = await aggregate(ROWS, VALUES());
        await render({ column });

        await hoverBar(0);
        expect(header()).toBe('4 rows (40%)');
        expect(axisLabels()).toEqual(['a']);
        expect(totalBars()[0].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.totalBarFocused);
        expect(cell().style.zIndex).toBe('100');

        await hoverBar(3);
        expect(header()).toBe('2 rows (20%)');
        expect(axisLabels()).toEqual(['c']);
        expect(totalBars()[0].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.totalBar);
        expect(totalBars()[3].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.totalBarFocused);

        // The null value is shown as the null symbol
        await hoverBar(2);
        expect(header()).toBe('2 rows (20%)');
        expect(axisLabels()).toEqual(['∅']);
        expect(totalBars()[2].getAttribute('fill')).toBe(COLUMN_SUMMARY_NULL_COLORS.totalBarFocused);

        await pointer('pointerout', center(totalBars()[2]));
        expect(header()).toBe('Text');
        expect(axisLabels()).toEqual(['40%', '20%']);
        expect(cell().style.zIndex).toBe('');
    });

    it('describes the values at the edges of their bars', async () => {
        const column = await aggregate(ROWS, VALUES());
        await render({ column });

        const expected = ['a', 'b', '∅', 'c'];
        for (const [i, bar] of totalBars().entries()) {
            const bounds = bar.getBoundingClientRect();
            const clientY = bounds.top + bounds.height / 2;
            await pointer('pointermove', { clientX: bounds.left + 0.5, clientY });
            expect(axisLabels()).toEqual([expected[i]]);
            await pointer('pointermove', { clientX: bounds.right - 0.5, clientY });
            expect(axisLabels()).toEqual([expected[i]]);
        }
    });

    it('describes no value left of the bars', async () => {
        const column = await aggregate(ROWS, VALUES());
        await render({ column });

        await hoverBar(1);
        const bounds = pointerTarget().getBoundingClientRect();
        await pointer('pointermove', { clientX: bounds.left - 2, clientY: bounds.top + 2 });
        expect(header()).toBe('Text');
        expect(axisLabels()).toEqual(['40%', '20%']);
    });

    it('truncates long values under the pointer', async () => {
        const long = 'x'.repeat(150);
        const column = await aggregate(tableAggregate(2, 2, 1), frequentValues([long], [1n], [2n]));
        await render({ column, table: tableAggregate(2, 2, 1) });

        await hoverBar(0);
        expect(axisLabels()).toEqual([`${'x'.repeat(97)}...`]);
    });

    it('filters by the clicked value once per frame', async () => {
        const column = await aggregate(ROWS, VALUES());
        const { onFilter } = await render({ column });

        click(pointerTarget(), center(totalBars()[1]));
        click(pointerTarget(), center(totalBars()[3]));
        expect(onFilter).not.toHaveBeenCalled();
        await act(async () => { await nextFrame(); });

        // The last click of the frame wins and names the value by its id
        expect(onFilter).toHaveBeenCalledOnce();
        expect(onFilter).toHaveBeenCalledWith(ROWS, 3, column, 3);

        // The null value has an id too
        click(pointerTarget(), center(totalBars()[2]));
        await act(async () => { await nextFrame(); });
        expect(onFilter).toHaveBeenLastCalledWith(ROWS, 3, column, 4);
    });

    it('clears the filter when clicking outside of the bars', async () => {
        const column = await aggregate(ROWS, VALUES());
        const { onFilter } = await render({ column });

        click(cell().firstElementChild!.firstElementChild!);
        await act(async () => { await nextFrame(); });
        expect(onFilter).toHaveBeenCalledOnce();
        expect(onFilter).toHaveBeenCalledWith(ROWS, 3, column, null);
    });

    it('drops a pending filter when it unmounts', async () => {
        const column = await aggregate(ROWS, VALUES());
        const { onFilter } = await render({ column });

        click(pointerTarget(), center(totalBars()[0]));
        root!.unmount();
        root = null;
        await nextFrame();
        await nextFrame();
        expect(onFilter).not.toHaveBeenCalled();
    });

    it('reports the filter to the latest callback', async () => {
        const column = await aggregate(ROWS, VALUES());
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = await render({ column, onFilter: first });

        click(pointerTarget(), center(totalBars()[0]));
        rerender(
            <MostFrequentCell
                className="cell"
                style={{ width: '200px', height: '80px' }}
                tableAggregation={ROWS}
                columnIndex={3}
                columnAggregate={column}
                filteredColumnAggregation={null}
                onFilter={second}
            />
        );
        await act(async () => { await nextFrame(); });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith(ROWS, 3, column, 1);
    });

    it('fills the bars with the share of the selected rows', async () => {
        const column = await aggregate(ROWS, VALUES());
        // 3 selected rows: a (2), c (1)
        const filtered = await aggregateFiltered(ROWS, frequentValues(['a', 'c'], [1n, 3n], [2n, 1n]), 3);
        await render({ column, filtered });

        // The backgrounds fade while a filter is active
        expect(totalBars().map(bar => bar.getAttribute('fill'))).toEqual([
            COLUMN_SUMMARY_COLORS.totalBarWithFilter,
            COLUMN_SUMMARY_COLORS.totalBarWithFilter,
            COLUMN_SUMMARY_NULL_COLORS.totalBarWithFilter,
            COLUMN_SUMMARY_COLORS.totalBarWithFilter,
        ]);
        // a: 2 of 4 rows, b: none, null: none, c: 1 of 2 rows
        const fillShare = (bar: number) => {
            const rects = filteredBars(bar);
            if (rects.length < 2) return 0;
            return Number(rects[1].getAttribute('height')) / Number(rects[0].getAttribute('height'));
        };
        expect([0, 1, 2, 3].map(fillShare)).toEqual([0.5, 0, 0, 0.5]);
        // The fills grow from the bottom
        const [background, fill] = filteredBars(0);
        expect(fill.getBoundingClientRect().bottom).toBeCloseTo(background.getBoundingClientRect().bottom, 3);
        expect(fill.getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.filteredBar);

        // The description counts the selected rows
        await hoverBar(0);
        expect(header()).toBe('2 rows (66.67%)');
        expect(filteredBars(0)[1].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.filteredBarFocused);
        await hoverBar(1);
        expect(header()).toBe('0 rows (0%)');
        await hoverBar(3);
        expect(header()).toBe('1 row (33.33%)');
    });

    it('ignores filtered aggregates of other column types', async () => {
        const column = await aggregate(ROWS, VALUES());
        const other = { type: Symbol('OTHER'), value: null } as unknown as WithFilterEpoch<ColumnAggregationVariant>;
        await render({ column, filtered: other });

        expect(totalBars()[0].getAttribute('fill')).toBe(COLUMN_SUMMARY_COLORS.totalBar);
        await hoverBar(0);
        expect(header()).toBe('4 rows (40%)');
    });

    it('reserves space for more values than it shows', async () => {
        // 40 distinct values, the 3 most frequent ones are shown
        const table = tableAggregate(100, 100, 40);
        const column = await aggregate(table, frequentValues(['a', 'b', 'c'], [1n, 2n, 3n], [10n, 5n, 5n]));
        const { onFilter } = await render({ column, table });

        const bars = totalBars();
        expect(bars).toHaveLength(3);
        const more = Array.from(plotGroups()[0].querySelectorAll<SVGRectElement>(':scope > g:last-child > rect'));
        expect(more).toHaveLength(1);
        const moreBounds = more[0].getBoundingClientRect();
        expect(moreBounds.left).toBeGreaterThanOrEqual(bars[2].getBoundingClientRect().right);
        expect(axisLabels()).toEqual(['10%', '5%']);

        // Pointing at the more button describes no value, and clicking it clears the filter
        const at = { clientX: moreBounds.left + moreBounds.width / 2, clientY: moreBounds.top + moreBounds.height / 2 };
        await pointer('pointermove', at);
        expect(header()).toBe('Text');
        click(pointerTarget(), at);
        await act(async () => { await nextFrame(); });
        expect(onFilter).toHaveBeenCalledWith(table, 3, column, null);
    });

    it('labels columns with distinct values', async () => {
        const table = tableAggregate(3, 3, 3);
        const column = await aggregate(table, frequentValues(['a', 'b', 'c'], [1n, 2n, 3n], [1n, 1n, 1n]));
        await render({ column, table });

        expect(column.analysis.isUnique).toBe(true);
        expect(cell().textContent).toContain('all distinct');
    });

    it('shows an empty column without values', async () => {
        const table = tableAggregate(0, 0, 0);
        const column = await aggregate(table, frequentValues([], [], []));
        const { onFilter } = await render({ column, table });

        expect(totalBars()).toHaveLength(0);
        expect(axisLabels()).toEqual(['0%', '0%']);
        await pointer('pointermove', center(pointerTarget()));
        expect(header()).toBe('Text');
        click(pointerTarget());
        await act(async () => { await nextFrame(); });
        expect(onFilter).toHaveBeenCalledWith(table, 3, column, null);
    });
});
