import * as React from 'react';
import * as arrow from 'apache-arrow';
import { act } from '@dashql/browser-test-act';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as styles from './column_aggregation_bar.module.css';
import { analyzeTable } from '../../compute/analyze_table.js';
import { ComputationRegistry, useComputationRegistry } from '../../compute/computation_registry.js';
import { ComputationScheduler } from '../../compute/computation_scheduler.js';
import type { ComputationAction, ComputationState } from '../../compute/computation_state.js';
import { MOST_FREQUENT_FILTER } from '../../compute/cross_filters.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';
import { setupWebHyperDB } from '../../platform/hyperdb/hyperdb_provider_web.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import type { QueryExecutionState } from '../../query/query_execution_state.js';
import type { Dispatch } from '../../utils/variant.js';
import { vectorFromArray } from '../../tests/arrow_fixtures.js';
import { createTestRoot } from '../../tests/react_root.js';
import { COLUMN_SUMMARY_COLORS } from '../query_result/data_table_colors.js';
import { ColumnAggregationBar } from './column_aggregation_bar.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const QUERY = { queryId: 1 } as unknown as QueryExecutionState;

/// 6 rows: the names a (3), b (2), c (1) and the scores 1 to 6
const TABLE = () => new arrow.Table({
    name: vectorFromArray(['a', 'a', 'a', 'b', 'b', 'c'], new arrow.Utf8()),
    score: vectorFromArray([1, 2, 3, 4, 5, 6], new arrow.Float64()),
});

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

describe('ColumnAggregationBar', () => {
    let database: EmbeddedComputeDatabase;
    let root: ReturnType<typeof createTestRoot> | null = null;
    const computation = { state: null as ComputationState | null, dispatch: null as Dispatch<ComputationAction> | null };

    beforeAll(async () => {
        database = await setupWebHyperDB('column_aggregation_bar_test', new TestLogger());
    });
    afterAll(async () => {
        await database?.terminate();
    });
    afterEach(() => {
        root?.unmount();
        root = null;
    });

    function Capture() {
        [computation.state, computation.dispatch] = useComputationRegistry();
        return null;
    }

    function render(width = 600, query: QueryExecutionState | null = QUERY, showBar = true) {
        root ??= createTestRoot();
        root.container.style.width = `${width}px`;
        root.render(
            <LoggerProvider>
                <ComputationRegistry>
                    <ComputationScheduler>
                        <Capture />
                        {showBar ? <ColumnAggregationBar query={query} /> : null}
                    </ComputationScheduler>
                </ComputationRegistry>
            </LoggerProvider>
        );
    }

    /// Analyze the table like a query result, the scheduler computes the aggregates with Hyper
    async function analyze() {
        await act(async () => {
            await analyzeTable(1, TABLE(), computation.dispatch!, database, new TestLogger());
        });
    }

    const bar = () => root!.container.querySelector<HTMLElement>(`.${styles.root}`);
    const columns = () => Array.from(root!.container.querySelectorAll<HTMLElement>(`.${styles.column}`));
    const columnNames = () => columns().map(column => column.querySelector(`.${styles.column_name}`)!.textContent);
    const plot = (column: number) => columns()[column].querySelector('svg');
    /// Wait until every column shows its plot
    async function plotsShown() {
        await act(async () => {
            await vi.waitFor(() => {
                expect(columns()).toHaveLength(2);
                expect(plot(0)).not.toBeNull();
                expect(plot(1)).not.toBeNull();
            });
            await nextFrame();
            await nextFrame();
        });
    }

    it('shows nothing without a query result', async () => {
        render(600, null);
        expect(bar()).toBeNull();
        root!.unmount();
        root = null;
        render(600, { queryId: 7 } as unknown as QueryExecutionState);
        expect(bar()).toBeNull();
    });

    it('shows the plots of the columns of an analyzed result without the row numbers', async () => {
        render();
        await analyze();
        await plotsShown();

        expect(columnNames()).toEqual(['name', 'score']);
        expect(columns()[0].querySelector(`.${styles.column_name}`)!.getAttribute('title')).toBe('name');
        // The columns fill the width of the bar
        const widths = columns().map(column => column.getBoundingClientRect().width);
        expect(widths[0] + widths[1]).toBeCloseTo(bar()!.getBoundingClientRect().width, 0);
        // The text column shows its most frequent values, the numbers their histogram
        expect(columns()[0].textContent).toContain('Text');
        expect(columns()[1].textContent).not.toContain('Text');
    });

    it('filters the other columns by the clicked value', async () => {
        render();
        await analyze();
        await plotsShown();

        // Click the bar of the most frequent value a
        const nameBar = plot(0)!.querySelector<SVGRectElement>(':scope > g > g > rect[y]')!;
        const pointerTarget = plot(0)!.querySelectorAll<SVGGElement>(':scope > g')[2].querySelector('rect')!;
        const bounds = nameBar.getBoundingClientRect();
        await act(async () => {
            pointerTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
            await nextFrame();
        });

        const table = () => computation.state!.tableComputations[1]!;
        expect(Object.values(table().crossFilters.columnFilters).map(filter => filter.type)).toEqual([MOST_FREQUENT_FILTER]);
        // The selection filters the table and the histogram of the scores shows the selected rows
        await act(async () => {
            await vi.waitFor(() => {
                expect(table().filterTable?.dataTable.numRows).toBe(3);
                const filled = Array.from(plot(1)!.querySelectorAll('rect')).filter(rect => rect.getAttribute('fill') === COLUMN_SUMMARY_COLORS.filteredBar);
                expect(filled.length).toBeGreaterThan(0);
            });
        });

        // Clicking the value again clears the filter
        await act(async () => {
            pointerTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }));
            await nextFrame();
        });
        expect(table().crossFilters.columnFilters).toEqual({});
        await act(async () => {
            await vi.waitFor(() => expect(table().filterTable).toBeNull());
        });
    });

    it('shows the plots of a result that arrives after it was mounted', async () => {
        render();
        await act(async () => { await nextFrame(); });
        expect(bar()).toBeNull();
        await analyze();
        await plotsShown();
        expect(columnNames()).toEqual(['name', 'score']);
    });

    it('shows the plots of a result that was analyzed before it was mounted', async () => {
        render(600, QUERY, false);
        await analyze();
        await act(async () => {
            await vi.waitFor(() => expect(computation.state!.tableComputations[1]?.columnAggregates.filter(a => a != null)).toHaveLength(2));
        });
        render(600, QUERY, true);
        await plotsShown();
        expect(columnNames()).toEqual(['name', 'score']);
    });

    it('mounts only the plots near the visible part of the bar', async () => {
        // Columns are at least 120 pixels wide, a narrow bar scrolls through them and mounts the plots up to a width
        // to the right of what it shows
        render(40);
        await analyze();
        await act(async () => {
            await vi.waitFor(() => expect(plot(0)).not.toBeNull());
        });
        const scroll = bar()!.querySelector<HTMLElement>(`.${styles.scroll}`)!;
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
        expect(plot(1)).toBeNull();

        await act(async () => {
            scroll.scrollLeft = scroll.scrollWidth;
            scroll.dispatchEvent(new Event('scroll'));
            await nextFrame();
            await nextFrame();
        });
        await act(async () => {
            await vi.waitFor(() => expect(plot(1)).not.toBeNull());
        });
    });
});
