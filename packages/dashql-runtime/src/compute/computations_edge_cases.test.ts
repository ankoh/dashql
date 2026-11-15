import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import { analyzeTable } from './analyze_table.js';
import { createComputations, type Computations } from './computations.js';
import { scheduleTask } from './computation_tasks.js';
import {
    DATA_SEARCH_TASK,
    FILTERED_COLUMN_AGGREGATION_TASK,
    ORDINAL_COLUMN,
    STRING_COLUMN,
    TABLE_FILTERING_TASK,
    TABLE_ORDERING_TASK,
    type OrdinalColumnAnalysis,
    type OrdinalGridColumnGroup,
    type StringColumnAnalysis,
    type StringGridColumnGroup,
} from './computation_types.js';
import { SET_RESULT_SEARCH_PATTERN, type TableComputationState } from './computation_state.js';
import { openTestHyperDB } from '../testing/test_hyperdb.js';
import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';
import { TestLogger } from '../testing/test_logger.js';
import { vectorFromArray } from '../testing/arrow_fixtures.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

// The SQL of the tasks of the computations in the core on the embedded Hyper, with the values that are easy to get
// wrong: NaN and infinities, nulls, booleans, dates, times of day and timestamps, empty tables, small integer domains,
// ties of frequent values, and the order of equal rows. The SQL text is compared in the Rust tests of the core runtime
// (tests/compute_tasks_test.rs), these run it.

const TABLE_ID = 1;
const TIMEOUT = 60_000;

let dql: core.DashQL;
let database: HyperDB;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    database = await openTestHyperDB('computations_edge_cases_test');
}, TIMEOUT);
afterAll(async () => {
    await database?.terminate();
});

describe('Computations in the core on edge cases', () => {
    let computations: Computations | null = null;

    afterEach(() => {
        computations?.destroy();
        computations = null;
    });

    /// Analyze a table with the computations of the core
    async function analyze(columns: Record<string, arrow.Vector>): Promise<TableComputationState> {
        computations = createComputations(new TestLogger(), dql);
        await analyzeTable(TABLE_ID, new arrow.Table(columns), computations.dispatch, database, new TestLogger(), 'main');
        return current();
    }

    function current(): TableComputationState {
        return computations!.store.current.tableComputations[TABLE_ID];
    }

    /// The ordinal column group of a field
    function ordinal(computation: TableComputationState, field: string): [number, OrdinalGridColumnGroup] {
        const index = computation.columnGroups.findIndex(group => group.type === ORDINAL_COLUMN && group.value.inputFieldName === field);
        const group = computation.columnGroups[index];
        if (group?.type !== ORDINAL_COLUMN) throw new Error(`no ordinal column ${field}`);
        return [index, group.value];
    }

    /// The string column group of a field
    function string(computation: TableComputationState, field: string): [number, StringGridColumnGroup] {
        const index = computation.columnGroups.findIndex(group => group.type === STRING_COLUMN && group.value.inputFieldName === field);
        const group = computation.columnGroups[index];
        if (group?.type !== STRING_COLUMN) throw new Error(`no string column ${field}`);
        return [index, group.value];
    }

    /// The values of a field of the table with the system columns, in the order of the rows
    function systemColumn(computation: TableComputationState, field: string): unknown[] {
        return computation.dataTable.toArray().map(row => row[field]);
    }

    /// The histogram of an ordinal column: the analysis and the binned values as the SQL returned them
    function histogram(computation: TableComputationState, field: string): { analysis: OrdinalColumnAnalysis, bins: BinRow[] } {
        const [index] = ordinal(computation, field);
        const aggregate = computation.columnAggregates[index];
        if (aggregate?.type !== ORDINAL_COLUMN) throw new Error(`no histogram of ${field}`);
        return { analysis: aggregate.value.columnAnalysis, bins: binRows(aggregate.value.binnedValues) };
    }

    /// The frequent values of a string column
    function frequentValues(computation: TableComputationState, field: string): StringColumnAnalysis {
        const [index] = string(computation, field);
        const aggregate = computation.columnAggregates[index];
        if (aggregate?.type !== STRING_COLUMN) throw new Error(`no frequent values of ${field}`);
        return aggregate.value.analysis;
    }

    /// The frequent values with their counts, ordered by value since ties have no order
    function valueCounts(analysis: StringColumnAnalysis): [string | null, bigint][] {
        return analysis.frequentValueStrings
            .map((value, i): [string | null, bigint] => [value, analysis.frequentValueCounts[i]])
            .sort(([l], [r]) => (l ?? '￿').localeCompare(r ?? '￿'));
    }

    /// Filter the rows, the row numbers in the order of the table
    async function filter(filters: { fieldName: string, op: '<' | '<=' | '>' | '>=' | '=', value: number }[]): Promise<bigint[]> {
        const computation = current();
        const result = await scheduleTask(TABLE_FILTERING_TASK, {
            tableId: TABLE_ID,
            tableVersion: computation.version,
            inputDataTable: computation.dataTable,
            inputDataTableFieldIndex: computation.dataTableFieldsByName,
            inputDataFrame: computation.dataFrame!,
            rowNumberColumnName: computation.rowNumberColumnName!,
            filters,
        }, computations!.dispatch);
        return rowNumbers(result!.dataTable, computation.rowNumberColumnName!);
    }

    /// Order the rows, the row numbers in display order
    async function order(orderingConstraints: { field: string, ascending?: boolean, nullsFirst?: boolean }[]): Promise<bigint[]> {
        const computation = current();
        const result = await scheduleTask(TABLE_ORDERING_TASK, {
            tableId: TABLE_ID,
            tableVersion: computation.version,
            inputDataTable: computation.dataTable,
            inputDataTableFieldIndex: computation.dataTableFieldsByName,
            inputDataFrame: computation.dataFrame!,
            filterTable: computation.filterTable,
            dataSearchTable: computation.dataSearchTable,
            rowNumberColumnName: computation.rowNumberColumnName!,
            orderingConstraints,
        }, computations!.dispatch);
        expect(result.dataTable.schema.fields.map(field => field.name)).toEqual([computation.rowNumberColumnName]);
        return rowNumbers(result.dataTable, computation.rowNumberColumnName!);
    }

    /// Search the data of the fields, the matching columns by row number
    async function search(fields: string[], pattern: string): Promise<Map<number, number[]> | null> {
        computations!.dispatch({ type: SET_RESULT_SEARCH_PATTERN, value: [TABLE_ID, 'data', pattern] });
        const computation = current();
        const columns = fields.map((fieldName, columnIdx) => ({
            columnIdx,
            columnGroupIdx: computation.columnGroups.findIndex(group => 'inputFieldName' in group.value && group.value.inputFieldName === fieldName),
            fieldName,
        }));
        await scheduleTask(DATA_SEARCH_TASK, {
            tableId: TABLE_ID,
            tableVersion: computation.version,
            inputDataFrame: computation.dataFrame!,
            rowNumberColumnName: computation.rowNumberColumnName!,
            columns,
            pattern,
            requestId: computation.dataSearch.requestId,
            abortController: new AbortController(),
        }, computations!.dispatch);
        expect(current().dataSearch).toMatchObject({ appliedPattern: pattern, pending: false, error: null });
        return current().dataSearch.matchingRows;
    }

    /// Summarize a column over the rows of the filter and the data search of the computation
    async function filteredAggregate(columnId: number, selectionRowCount: number) {
        const computation = current();
        const filtered = await scheduleTask(FILTERED_COLUMN_AGGREGATION_TASK, {
            tableId: TABLE_ID,
            tableVersion: computation.filterTable?.version ?? computation.version,
            columnId,
            columnEntry: computation.columnGroups[columnId],
            inputDataFrame: computation.dataFrame!,
            tableAggregate: computation.tableAggregation!,
            filterTable: computation.filterTable,
            dataSearchTable: computation.dataSearchTable,
            selectionRowCount,
            unfilteredAggregate: computation.columnAggregates[columnId]!,
        }, computations!.dispatch);
        expect(filtered).toBe(current().filteredColumnAggregates[columnId]);
        return filtered!;
    }

    describe('histograms', () => {
        it('bins floating-point values into 16 bins with a bin of the nulls', async () => {
            const scores = [
                42, 10, 10, 30,
                436, 28054, 7554, 23269, 3972,
                17470, 25733, 5638, 27309, 11486,
                12329, 22070, 9231, 2636, 15536,
            ];
            const computation = await analyze({ score: vectorFromArray(scores, new arrow.Float64()) });
            const { analysis, bins } = histogram(computation, 'score');

            // bin width = (28054 - 10) / 16 = 1752.75, the maximum lands in the last bin
            expect(bins).toHaveLength(17);
            expect(bins.map(bin => bin.bin)).toEqual(Array.from({ length: 17 }, (_, i) => i));
            expect(bins.map(bin => bin.count)).toEqual([5n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, null, null, 1n, 1n, 1n, 2n, null]);
            for (const bin of bins.slice(0, 16)) expect(bin.binWidth).toBeCloseTo(1752.75, 6);
            expect(bins[0].binLowerBound).toBeCloseTo(10, 6);
            expect(bins[0].binUpperBound).toBeCloseTo(1762.75, 6);
            expect(bins[15].binLowerBound).toBeCloseTo(26301.25, 6);
            expect(bins[15].binUpperBound).toBeCloseTo(28054, 6);
            // The bin of the nulls has no bounds
            expect(bins[16]).toMatchObject({ binWidth: null, binLowerBound: null, binUpperBound: null });

            expect(analysis).toMatchObject({ totalCount: 19, countNull: 0, countNotNull: 19, binCount: 16 });
            expect([...analysis.binValueCounts]).toEqual([5n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 1n, 0n, 0n, 1n, 1n, 1n, 2n]);
            expect(analysis.binPercentages[0]).toBeCloseTo(5 / 19, 9);
        }, TIMEOUT);

        it('keeps NaN and infinities in the bins', async () => {
            // A non-finite value bins to NaN or far outside of INT32, the bin is clamped before the cast to INTEGER
            const computation = await analyze({
                score: vectorFromArray([10, 10, NaN, Infinity, -Infinity, 10.0000001], new arrow.Float64()),
            });
            const { analysis, bins } = histogram(computation, 'score');

            expect(bins).toHaveLength(17);
            for (const bin of bins) {
                expect(bin.bin).toBeGreaterThanOrEqual(0);
                expect(bin.bin).toBeLessThanOrEqual(16);
            }
            expect(analysis).toMatchObject({ totalCount: 6, countNull: 0, countNotNull: 6 });
            expect(analysis.binValueCounts.reduce((sum, count) => sum + count, 0n)).toBe(6n);
        }, TIMEOUT);

        it('keeps a positive infinity in the bins', async () => {
            const computation = await analyze({ score: vectorFromArray([1, 2, Infinity, null], new arrow.Float64()) });
            const { analysis, bins } = histogram(computation, 'score');

            expect(bins).toHaveLength(17);
            expect(analysis).toMatchObject({ totalCount: 4, countNull: 1, countNotNull: 3 });
            expect(analysis.binValueCounts.reduce((sum, count) => sum + count, 0n)).toBe(3n);
            // The bin width is infinite: 1 and 2 bin to 0, the infinity to NaN. Hyper orders NaN above every number,
            // FLOOR(NaN) >= 16 holds and NaN lands in the last bin, not in bin 0 as the comment of the clamp in
            // sql.rs says.
            expect(systemColumn(computation, ordinal(computation, 'score')[1].binFieldName!)).toEqual([0, 0, NaN, null]);
            expect([...analysis.binValueCounts]).toEqual([2n, ...Array(14).fill(0n), 1n]);
        }, TIMEOUT);

        it('bins a column of one value into the first bin', async () => {
            // The range is 0, the bin width the smallest one
            const computation = await analyze({ score: vectorFromArray([5.5, 5.5, 5.5], new arrow.Float64()) });
            const { analysis, bins } = histogram(computation, 'score');

            expect(systemColumn(computation, ordinal(computation, 'score')[1].binFieldName!)).toEqual([0, 0, 0]);
            expect(bins[0]).toMatchObject({ bin: 0, count: 3n });
            expect(bins[0].binWidth).toBeCloseTo(1e-15, 20);
            expect([...analysis.binValueCounts]).toEqual([3n, ...Array(15).fill(0n)]);
        }, TIMEOUT);

        it('bins nearly constant values without leaving the bins', async () => {
            const computation = await analyze({ score: vectorFromArray([10, 10, 10.0000001], new arrow.Float64()) });
            const { analysis } = histogram(computation, 'score');

            expect(analysis.binValueCounts[0]).toBe(2n);
            expect(analysis.binValueCounts[15]).toBe(1n);
        }, TIMEOUT);

        it('counts the nulls of an ordinal column in the bin after the last one', async () => {
            const computation = await analyze({ score: vectorFromArray([1.5, null, 3, null, 3], new arrow.Float64()) });
            const { analysis, bins } = histogram(computation, 'score');

            expect(systemColumn(computation, ordinal(computation, 'score')[1].binFieldName!)).toEqual([0, null, 16, null, 16]);
            expect(bins[16]).toMatchObject({ bin: 16, count: 2n });
            expect(analysis).toMatchObject({ totalCount: 5, countNull: 2, countNotNull: 3 });
            expect(analysis.binValueCounts[0]).toBe(1n);
            expect(analysis.binValueCounts[15]).toBe(2n);
            expect(analysis.minValue).toMatch(/^1\.5/);
            expect(analysis.maxValue).toMatch(/^3/);
        }, TIMEOUT);

        it('summarizes a column of nulls', async () => {
            const computation = await analyze({
                score: vectorFromArray([null, null], new arrow.Float64()),
                amount: vectorFromArray([null, null], new arrow.Int32()),
            });
            for (const field of ['score', 'amount']) {
                const { analysis, bins } = histogram(computation, field);
                expect(bins).toHaveLength(17);
                expect(bins[16]).toMatchObject({ bin: 16, count: 2n });
                expect(analysis).toMatchObject({ totalCount: 2, countNull: 2, countNotNull: 0, binCount: 16, minValue: '', maxValue: '' });
                expect(analysis.binValueCounts.every(count => count === 0n)).toBe(true);
            }
        }, TIMEOUT);

        it('uses one bin per value of a small integer domain', async () => {
            const computation = await analyze({ value: vectorFromArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], new arrow.Int32()) });
            const [, column] = ordinal(computation, 'value');
            const { analysis, bins } = histogram(computation, 'value');

            expect(column.binCount).toBe(10);
            expect(systemColumn(computation, column.binFieldName!)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            expect(bins).toHaveLength(11);
            expect(bins.slice(0, 10).map(bin => bin.count)).toEqual(Array(10).fill(1n));
            expect(bins.slice(0, 10).map(bin => bin.binLowerBound)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
            expect(bins.slice(0, 10).map(bin => bin.binWidth)).toEqual(Array(10).fill(1));
            expect(analysis.binCount).toBe(10);
            expect(analysis.binLowerBounds).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
        }, TIMEOUT);

        it('keeps 16 bins of a wider integer domain with bins of at least one value', async () => {
            const computation = await analyze({ value: vectorFromArray([0n, 3n, 16n, 16n], new arrow.Int64()) });
            const [, column] = ordinal(computation, 'value');
            const { analysis, bins } = histogram(computation, 'value');

            expect(column.binCount).toBe(16);
            for (const bin of bins.slice(0, 16)) expect(bin.binWidth).toBe(1);
            expect(analysis.binValueCounts[0]).toBe(1n);
            expect(analysis.binValueCounts[3]).toBe(1n);
            expect(analysis.binValueCounts[15]).toBe(2n);
        }, TIMEOUT);

        it('bins booleans as 0 and 1', async () => {
            const computation = await analyze({ email_opt_out: vectorFromArray([false, true, null], new arrow.Bool()) });
            const [, column] = ordinal(computation, 'email_opt_out');
            const { analysis, bins } = histogram(computation, 'email_opt_out');

            expect(systemColumn(computation, column.binFieldName!)).toEqual([0, 16, null]);
            expect(bins).toHaveLength(17);
            expect(bins[0]).toMatchObject({ bin: 0, count: 1n, binLowerBound: 0, binUpperBound: 0.0625 });
            expect(bins[15]).toMatchObject({ bin: 15, count: 1n, binLowerBound: 0.9375, binUpperBound: 1 });
            expect(bins[16]).toMatchObject({ bin: 16, count: 1n, binLowerBound: null, binUpperBound: null });
            expect(analysis).toMatchObject({ totalCount: 3, countNull: 1, countNotNull: 2 });
        }, TIMEOUT);

        it('bins timestamps by their seconds with bounds in epoch milliseconds', async () => {
            const start = Date.UTC(2024, 0, 1);
            const computation = await analyze({
                occurred_at: vectorFromArray([new Date(start), new Date(start + 5_000), new Date(start + 10_000)], new arrow.TimestampMillisecond()),
            });
            const [, column] = ordinal(computation, 'occurred_at');
            const { analysis, bins } = histogram(computation, 'occurred_at');

            // The bin width is 10 s / 16
            expect(systemColumn(computation, column.binFieldName!).map(Number)).toEqual([0, 8, 16]);
            expect(bins.map(bin => bin.count)).toEqual([1n, null, null, null, null, null, null, null, 1n, null, null, null, null, null, null, 1n, null]);
            expect(bins[0].binWidth).toBeCloseTo(0.625, 9);
            expect(bins[0].binLowerBound).toBeCloseTo(start, 3);
            expect(bins[8].binLowerBound).toBeCloseTo(start + 5_000, 3);
            expect(bins[15].binUpperBound).toBeCloseTo(start + 10_000, 3);
            expect(analysis).toMatchObject({ totalCount: 3, countNull: 0, countNotNull: 3 });
            // The host formats the bounds
            expect(analysis.binLowerBounds.every(bound => bound !== '')).toBe(true);
        }, TIMEOUT);

        it('bins dates by their seconds with bounds in epoch milliseconds', async () => {
            const day = 86_400_000;
            const start = Date.UTC(2024, 0, 1);
            const computation = await analyze({
                day: vectorFromArray([new Date(start), new Date(start + day), new Date(start + 2 * day), null], new arrow.DateDay()),
            });
            const [, column] = ordinal(computation, 'day');
            const { analysis, bins } = histogram(computation, 'day');

            expect(systemColumn(computation, column.binFieldName!).map(value => value == null ? null : Number(value))).toEqual([0, 8, 16, null]);
            expect(bins[0]).toMatchObject({ bin: 0, count: 1n });
            expect(bins[8]).toMatchObject({ bin: 8, count: 1n });
            expect(bins[15]).toMatchObject({ bin: 15, count: 1n });
            expect(bins[16]).toMatchObject({ bin: 16, count: 1n });
            expect(bins[0].binLowerBound).toBeCloseTo(start, 3);
            expect(bins[15].binUpperBound).toBeCloseTo(start + 2 * day, 3);
            expect(analysis).toMatchObject({ totalCount: 4, countNull: 1, countNotNull: 3 });
        }, TIMEOUT);

        it('bins times of day by their seconds since midnight', async () => {
            const noon = 12 * 3_600_000;
            const computation = await analyze({
                occurred_at: vectorFromArray([noon, noon + 5_000, noon + 10_000], new arrow.TimeMillisecond()),
            });
            const [, column] = ordinal(computation, 'occurred_at');

            expect(systemColumn(computation, column.binFieldName!).map(Number)).toEqual([0, 8, 16]);
        }, TIMEOUT);

        it('groups times of day into bins with bounds in milliseconds since midnight', async () => {
            const noon = 12 * 3_600_000;
            const computation = await analyze({
                occurred_at: vectorFromArray([noon, noon + 1_000, noon + 10_000], new arrow.TimeMillisecond()),
            });
            const { analysis, bins } = histogram(computation, 'occurred_at');

            // 1 s / 0.625 s is bin 1
            expect([...analysis.binValueCounts]).toEqual([1n, 1n, ...Array(13).fill(0n), 1n]);
            expect(bins[0].binLowerBound).toBeCloseTo(noon, 3);
            expect(bins[15].binUpperBound).toBeCloseTo(noon + 10_000, 3);
        }, TIMEOUT);

        it('summarizes an empty table', async () => {
            const computation = await analyze({
                score: vectorFromArray([], new arrow.Float64()),
                name: vectorFromArray([], new arrow.Utf8()),
            });
            expect(computation.dataTable.numRows).toBe(0);
            expect(computation.tableAggregation?.table.numRows).toBe(1);

            const { analysis, bins } = histogram(computation, 'score');
            expect(bins).toHaveLength(17);
            expect(bins.every(bin => bin.count == null)).toBe(true);
            expect(analysis).toMatchObject({ totalCount: 0, countNull: 0, countNotNull: 0, minValue: '', maxValue: '' });
            expect(analysis.binPercentages.every(share => share === 0)).toBe(true);

            const name = frequentValues(computation, 'name');
            expect(name).toMatchObject({ totalCount: 0, countNull: 0, countNotNull: 0, countDistinct: 0, isUnique: true });
            expect(name.frequentValueStrings).toEqual([]);

            expect(await filter([{ fieldName: 'score', op: '>=', value: 0 }])).toEqual([]);
            expect(await order([{ field: 'score' }])).toEqual([]);
            expect(await search(['score', 'name'], 'a')).toEqual(new Map());
        }, TIMEOUT);
    });

    describe('frequent values', () => {
        it('counts the values with the nulls and gives them ids in ascending order with the nulls last', async () => {
            const computation = await analyze({ category: vectorFromArray(['B', 'A', null, 'A', 'B'], new arrow.Utf8()) });
            const [, column] = string(computation, 'category');
            const analysis = frequentValues(computation, 'category');

            // dense_rank() over the values: A is 1, B is 2, null is 3
            expect(systemColumn(computation, column.valueIdFieldName!)).toEqual([2n, 1n, 3n, 1n, 2n]);
            expect(analysis).toMatchObject({ totalCount: 5, countNotNull: 4, countNull: 1, countDistinct: 2, isUnique: false });
            // A and B are tied, the frequent values are ordered by count only
            expect(valueCounts(analysis)).toEqual([['A', 2n], ['B', 2n], [null, 1n]]);
            const ids = new Map(analysis.frequentValueStrings.map((value, i) => [value, analysis.frequentValueIds[i]]));
            expect(ids).toEqual(new Map([['A', 1n], ['B', 2n], [null, 3n]]));
            expect(analysis.frequentValueCounts[2]).toBe(1n);
            expect([...analysis.frequentValuePercentages]).toEqual([0.4, 0.4, 0.2]);
        }, TIMEOUT);

        it('orders the frequent values by count', async () => {
            const computation = await analyze({ category: vectorFromArray(['A', 'B', 'A', 'B', 'A', 'C'], new arrow.Utf8()) });
            const analysis = frequentValues(computation, 'category');

            expect(analysis.frequentValueStrings).toEqual(['A', 'B', 'C']);
            expect([...analysis.frequentValueCounts]).toEqual([3n, 2n, 1n]);
            expect([...analysis.frequentValueIds]).toEqual([1n, 2n, 3n]);
        }, TIMEOUT);

        it('keeps the 32 most frequent values', async () => {
            const values = ['top', 'top', 'top', ...Array.from({ length: 40 }, (_, i) => `v${i}`)];
            const computation = await analyze({ category: vectorFromArray(values, new arrow.Utf8()) });
            const analysis = frequentValues(computation, 'category');

            expect(analysis).toMatchObject({ totalCount: 43, countDistinct: 41, isUnique: false });
            expect(analysis.frequentValueStrings).toHaveLength(32);
            expect(analysis.frequentValueStrings[0]).toBe('top');
            expect([...analysis.frequentValueCounts]).toEqual([3n, ...Array(31).fill(1n)]);
        }, TIMEOUT);

        it('tells unique values', async () => {
            const computation = await analyze({ name: vectorFromArray(['x', 'y', 'z'], new arrow.Utf8()) });
            expect(frequentValues(computation, 'name')).toMatchObject({ countDistinct: 3, isUnique: true });
        }, TIMEOUT);
    });

    describe('filters', () => {
        it('keeps the rows in a range of floating-point values', async () => {
            await analyze({ score: vectorFromArray([42.0, 10.2, 10.1, 30.005], new arrow.Float64()) });
            expect(await filter([
                { fieldName: 'score', op: '>=', value: 10.1 },
                { fieldName: 'score', op: '<=', value: 10.2 },
            ])).toEqual([2n, 3n]);
            expect(await filter([{ fieldName: 'score', op: '>', value: 10.1 }, { fieldName: 'score', op: '<', value: 42 }])).toEqual([2n, 4n]);
        }, TIMEOUT);

        it('keeps the rows of a value id, also of the nulls', async () => {
            const computation = await analyze({ category: vectorFromArray(['B', 'A', null, 'A', 'B'], new arrow.Utf8()) });
            const [, column] = string(computation, 'category');

            expect(await filter([{ fieldName: column.valueIdFieldName!, op: '=', value: 1 }])).toEqual([2n, 4n]);
            expect(await filter([{ fieldName: column.valueIdFieldName!, op: '=', value: 3 }])).toEqual([3n]);
        }, TIMEOUT);

        it('keeps the rows of a range of bins and skips the nulls', async () => {
            // The bin width is 16 / 16 = 1
            const computation = await analyze({ score: vectorFromArray([0, null, 8, 16, 7.5], new arrow.Float64()) });
            const [, column] = ordinal(computation, 'score');

            expect(systemColumn(computation, column.binFieldName!)).toEqual([0, null, 8, 16, 7.5]);
            expect(await filter([
                { fieldName: column.binFieldName!, op: '>=', value: 0 },
                { fieldName: column.binFieldName!, op: '<', value: 8 },
            ])).toEqual([1n, 5n]);
            expect(await filter([{ fieldName: column.binFieldName!, op: '>=', value: 8 }])).toEqual([3n, 4n]);
        }, TIMEOUT);

        it('lists the rows of the filter in the order of the input', async () => {
            const values = Array.from({ length: 100 }, (_, i) => (i * 37) % 100);
            await analyze({ value: vectorFromArray(values, new arrow.Float64()) });

            const expected = values.flatMap((value, i) => value >= 50 ? [BigInt(i + 1)] : []);
            expect(await filter([{ fieldName: 'value', op: '>=', value: 50 }])).toEqual(expected);
        }, TIMEOUT);
    });

    describe('orderings', () => {
        it('orders floating-point values', async () => {
            await analyze({
                id: vectorFromArray([1, 2, 3, 4], new arrow.Int32()),
                score: vectorFromArray([42.0, 10.2, 10.1, 30.005], new arrow.Float64()),
            });
            expect(await order([{ field: 'score', ascending: true }])).toEqual([3n, 2n, 4n, 1n]);
            expect(await order([{ field: 'score', ascending: false }])).toEqual([1n, 4n, 2n, 3n]);
        }, TIMEOUT);

        it('orders the nulls last unless they come first', async () => {
            await analyze({ score: vectorFromArray([3, null, 1], new arrow.Float64()) });
            expect(await order([{ field: 'score' }])).toEqual([3n, 1n, 2n]);
            expect(await order([{ field: 'score', ascending: false }])).toEqual([1n, 3n, 2n]);
            expect(await order([{ field: 'score', nullsFirst: true }])).toEqual([2n, 3n, 1n]);
        }, TIMEOUT);

        it('orders equal rows by their row number', async () => {
            const groups = Array.from({ length: 100 }, (_, i) => (i * 7) % 5);
            await analyze({ group: vectorFromArray(groups, new arrow.Int32()) });

            const expected = groups
                .map((group, i) => ({ group, rowNumber: i + 1 }))
                .sort((l, r) => r.group - l.group || l.rowNumber - r.rowNumber)
                .map(row => BigInt(row.rowNumber));
            expect(await order([{ field: 'group', ascending: false }])).toEqual(expected);
        }, TIMEOUT);

        it('orders the rows of a filter only', async () => {
            await analyze({ score: vectorFromArray([5, 1, 4, 2, 3], new arrow.Float64()) });
            await filter([{ fieldName: 'score', op: '>=', value: 2 }]);
            expect(await order([{ field: 'score' }])).toEqual([4n, 5n, 3n, 1n]);
        }, TIMEOUT);
    });

    describe('system columns', () => {
        it('keep the order of the rows of the input', async () => {
            // Hyper numbers the rows of a table of 20 rows or more in another order with row_number() OVER ()
            const queries = Array.from({ length: 100 }, (_, i) => `select ${String.fromCharCode(97 + (i * 7) % 26)} from t${i}`);
            const computation = await analyze({
                query: vectorFromArray(queries, new arrow.Utf8()),
                total_ms: vectorFromArray(queries.map((_, i) => 10_000 - i * 100), new arrow.Float64()),
            });
            const rows = computation.dataTable.toArray();
            expect(rows.map(row => row.query)).toEqual(queries);
            expect(rows.map(row => row[computation.rowNumberColumnName!])).toEqual(queries.map((_, i) => BigInt(i + 1)));
        }, TIMEOUT);
    });

    describe('data searches', () => {
        it('lists the matching columns of every row', async () => {
            await analyze({
                name: vectorFromArray(['Alice', 'Bob', 'Carol'], new arrow.Utf8()),
                city: vectorFromArray(['Boston', 'Austin', 'Seattle'], new arrow.Utf8()),
            });
            expect(await search(['name', 'city'], 'a')).toEqual(new Map([[1, [0]], [2, [1]], [3, [0, 1]]]));
            // Case-insensitive
            expect(await search(['name', 'city'], 'BOS')).toEqual(new Map([[1, [1]]]));
            expect(await search(['name', 'city'], 'nothing')).toEqual(new Map());
        }, TIMEOUT);

        it('matches the text of numbers, booleans, timestamps and lists', async () => {
            await analyze({
                name: vectorFromArray(['Alice', 'Bob'], new arrow.Utf8()),
                score: vectorFromArray([10.5, 20], new arrow.Float64()),
                flagged: vectorFromArray([true, false], new arrow.Bool()),
                occurred_at: vectorFromArray([new Date(Date.UTC(2024, 0, 1)), new Date(Date.UTC(2024, 1, 2, 12))], new arrow.TimestampMillisecond()),
                tags: vectorFromArray([['red', 'blue'], ['green']], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
            });
            const fields = ['name', 'score', 'flagged', 'occurred_at', 'tags'];
            expect(await search(fields, 'ali')).toEqual(new Map([[1, [0]]]));
            expect(await search(fields, '10.5')).toEqual(new Map([[1, [1]]]));
            expect(await search(fields, '2024-02-02')).toEqual(new Map([[2, [3]]]));
            expect(await search(fields, 'red')).toEqual(new Map([[1, [4]]]));
            // A boolean matches as its text, true or false
            const matches = await search(fields, 'tru');
            expect(matches?.get(1)).toEqual([2]);
            expect(matches?.has(2)).toBe(false);
        }, TIMEOUT);

        it('takes a pattern with quotes literally', async () => {
            await analyze({ name: vectorFromArray(["O'Brien", 'Obrien'], new arrow.Utf8()) });
            expect(await search(['name'], "o'b")).toEqual(new Map([[1, [0]]]));
        }, TIMEOUT);
    });

    describe('filtered summaries', () => {
        it('count the frequent values and the bins of the selected rows', async () => {
            await analyze({
                name: vectorFromArray(['a', 'b', 'a', null, 'b', 'a'], new arrow.Utf8()),
                score: vectorFromArray([1, 2, 3, 4, null, 9], new arrow.Float64()),
            });
            await filter([{ fieldName: 'score', op: '<=', value: 4 }]);
            let computation = current();
            expect(computation.filterTable?.dataTable.numRows).toBe(4);

            const [nameId] = string(computation, 'name');
            const name = await filteredAggregate(nameId, 4);
            expect(name.type).toBe(STRING_COLUMN);
            if (name.type !== STRING_COLUMN) return;
            expect(name.value.analysis).toMatchObject({ totalCount: 4, countDistinct: 2 });
            expect(valueCounts(name.value.analysis)).toEqual([['a', 2n], ['b', 1n], [null, 1n]]);
            expect(name.value.analysis.frequentValueStrings[0]).toBe('a');
            expect(name.value.analysis.frequentValuePercentages[0]).toBe(0.5);

            computation = current();
            const [scoreId] = ordinal(computation, 'score');
            const score = await filteredAggregate(scoreId, 4);
            expect(score.type).toBe(ORDINAL_COLUMN);
            if (score.type !== ORDINAL_COLUMN) return;
            // The bins of all rows: width 8 / 16 = 0.5, 1 is bin 0, 2 bin 2, 3 bin 4, 4 bin 6
            const counts = Array(16).fill(0n);
            counts[0] = counts[2] = counts[4] = counts[6] = 1n;
            expect([...score.value.columnAnalysis.binValueCounts]).toEqual(counts);
            expect(score.value.columnAnalysis).toMatchObject({ totalCount: 4, countNull: 0 });
            expect(score.value.columnAnalysis.binPercentages[0]).toBe(0.25);
        }, TIMEOUT);

        it('count the rows of a filter and a data search', async () => {
            await analyze({
                name: vectorFromArray(['ann', 'bob', 'anna', 'hannah', 'ann'], new arrow.Utf8()),
                score: vectorFromArray([1, 2, 3, 4, 5], new arrow.Float64()),
            });
            await filter([{ fieldName: 'score', op: '>=', value: 3 }]);
            await search(['name'], 'ann');
            const computation = current();
            expect(computation.dataSearchTable?.dataTable.numRows).toBe(4);

            // Rows 3, 4 and 5 pass the filter and match
            const [nameId] = string(computation, 'name');
            const name = await filteredAggregate(nameId, 3);
            if (name.type !== STRING_COLUMN) throw new Error('a string column');
            expect(valueCounts(name.value.analysis)).toEqual([['ann', 1n], ['anna', 1n], ['hannah', 1n]]);
            expect(name.dataSearchRequestId).toBe(computation.dataSearchTable?.requestId);
        }, TIMEOUT);
    });
});

/// A row of the binned values of a histogram
interface BinRow {
    bin: number;
    count: bigint | null;
    binWidth: number | null;
    binLowerBound: number | null;
    binUpperBound: number | null;
}

/// A number of an Arrow value, null for null
function numberOf(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'bigint') return Number(value);
    return Number(value);
}

function binRows(table: arrow.Table): BinRow[] {
    return table.toArray().map(row => ({
        bin: numberOf(row.bin)!,
        count: row.count == null ? null : BigInt(row.count),
        binWidth: numberOf(row.binWidth),
        binLowerBound: numberOf(row.binLowerBound),
        binUpperBound: numberOf(row.binUpperBound),
    }));
}

function rowNumbers(table: arrow.Table, field: string): bigint[] {
    return table.toArray().map(row => BigInt(row[field]));
}
