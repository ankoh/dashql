// @vitest-environment node
import * as arrow from 'apache-arrow';
import { SQLFrame } from './sqlframe_builder.js';
import { instantiateTestWebDB } from '../duckdb/duckdb_test_worker.js';
import { DuckDB, DuckDBConnection } from '../duckdb/duckdb_api.js';

declare const WEBDB_PRECOMPILED: Promise<Uint8Array>;

let webdbWasmBinary: Uint8Array;

function toPlainObjects(table: arrow.Table): any[] {
    return table.toArray().map(row => {
        const obj: any = {};
        for (const key of Object.keys(row)) {
            obj[key] = row[key];
        }
        return obj;
    });
}

beforeAll(async () => {
    webdbWasmBinary = await WEBDB_PRECOMPILED;
});

describe('SQLFrame execution', () => {
    let webdb: DuckDB;
    let conn: DuckDBConnection;

    beforeEach(async () => {
        webdb = await instantiateTestWebDB(webdbWasmBinary);
        await webdb.open({
            maximumThreads: 1,
            query: { castBigIntToDouble: true },
        });
        conn = await webdb.connect();
    });

    afterEach(async () => {
        if (conn) await conn.close();
        if (webdb) webdb.terminate();
    });

    it('order by Float64', async () => {
        const table = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3, 4]),
            score: new Float64Array([42.0, 10.2, 10.1, 30.005]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .orderBy([{ field: "score", ascending: true }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { id: 3, score: 10.1 },
            { id: 2, score: 10.2 },
            { id: 4, score: 30.005 },
            { id: 1, score: 42.0 },
        ]);
    });

    it('row number', async () => {
        const table = arrow.tableFromArrays({
            id: new Int32Array([10, 20, 30]),
            name: ['Alice', 'Bob', 'Charlie'],
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .rowNumber("rn")
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows.length).toBe(3);
        const rns = rows.map((r: any) => r.rn).sort();
        expect(rns).toEqual([1, 2, 3]);
    });

    it('value identifier (dense_rank)', async () => {
        const table = arrow.tableFromArrays({
            category: ['B', 'A', 'C', 'A', 'B'],
            value: new Float64Array([1, 2, 3, 4, 5]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .valueIdentifier("category", "cat_id")
            .orderBy([{ field: "cat_id", ascending: true }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        const aRows = rows.filter((r: any) => r.category === 'A');
        const bRows = rows.filter((r: any) => r.category === 'B');
        const cRows = rows.filter((r: any) => r.category === 'C');

        expect(new Set(aRows.map((r: any) => r.cat_id)).size).toBe(1);
        expect(new Set(bRows.map((r: any) => r.cat_id)).size).toBe(1);
        expect(new Set(cRows.map((r: any) => r.cat_id)).size).toBe(1);

        const ids = [...new Set(rows.map((r: any) => r.cat_id))].sort();
        expect(ids).toEqual([1, 2, 3]);
    });

    it('scalar filter range', async () => {
        const table = arrow.tableFromArrays({
            score: new Float64Array([42.0, 10.2, 10.1, 30.005]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .rowNumber("rn")
            .filter("score", ">=", 10.1)
            .filter("score", "<=", 10.2)
            .project(["rn"])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows.length).toBe(2);
        const rns = rows.map((r: any) => r.rn).sort();
        expect(rns).toEqual([2, 3]);
    });

    it('semi-join filter', async () => {
        const mainTable = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3, 4, 5]),
            name: ['a', 'b', 'c', 'd', 'e'],
        });
        const filterTable = arrow.tableFromArrays({
            filter_id: new Int32Array([2, 4]),
        });
        await conn.insertArrowTable(mainTable, { name: 'input', create: true });
        await conn.insertArrowTable(filterTable, { name: 'ftable', create: true });

        const sql = SQLFrame.from("input")
            .semiJoinFilter("id", "ftable", "filter_id")
            .orderBy([{ field: "id" }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { id: 2, name: 'b' },
            { id: 4, name: 'd' },
        ]);
    });

    it('group by with count', async () => {
        const table = arrow.tableFromArrays({
            category: ['A', 'B', 'A', 'B', 'A'],
            value: new Float64Array([10, 20, 30, 40, 50]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .groupBy({
                keys: [{ fieldName: "category", outputAlias: "key" }],
                aggregates: [{ func: "count_star", outputAlias: "cnt" }],
            })
            .orderBy([{ field: "key" }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { key: 'A', cnt: 3 },
            { key: 'B', cnt: 2 },
        ]);
    });

    it('group by with aggregates', async () => {
        const table = arrow.tableFromArrays({
            category: ['A', 'B', 'A', 'B', 'A'],
            value: new Float64Array([10, 20, 30, 40, 50]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .groupBy({
                keys: [{ fieldName: "category", outputAlias: "cat" }],
                aggregates: [
                    { func: "min", fieldName: "value", outputAlias: "min_val" },
                    { func: "max", fieldName: "value", outputAlias: "max_val" },
                    { func: "avg", fieldName: "value", outputAlias: "avg_val" },
                ],
            })
            .orderBy([{ field: "cat" }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows).toEqual([
            { cat: 'A', min_val: 10, max_val: 50, avg_val: 30 },
            { cat: 'B', min_val: 20, max_val: 40, avg_val: 30 },
        ]);
    });

    it('binned group by', async () => {
        const table = arrow.tableFromArrays({
            score: new Float64Array([
                42, 10, 10, 30,
                436, 28054, 7554, 23269, 3972,
                17470, 25733, 5638, 27309, 11486,
                12329, 22070, 9231, 2636, 15536,
            ]),
        });
        const statsTable = arrow.tableFromArrays({
            min_score: new Float64Array([10]),
            max_score: new Float64Array([28054]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });
        await conn.insertArrowTable(statsTable, { name: 'stats', create: true });

        const sql = SQLFrame.from("input")
            .groupBy({
                keys: [{
                    fieldName: "score",
                    outputAlias: "bin",
                    binning: {
                        binCount: 8,
                        statsTable: "stats",
                        statsMinField: "min_score",
                        statsMaxField: "max_score",
                        outputBinWidthAlias: "bin_width",
                        outputBinLbAlias: "bin_lb",
                        outputBinUbAlias: "bin_ub",
                        includeNullBin: false,
                    },
                }],
                aggregates: [{ func: "count_star", outputAlias: "count" }],
            })
            .orderBy([{ field: "bin", ascending: true }])
            .toSQL();
        const result = await conn.query(sql);
        const rows = toPlainObjects(result);

        expect(rows.length).toBe(8);

        // bin_width = (28054 - 10) / 8 = 3505.5
        // Bin assignments for all 19 values:
        //   bin 0: 10, 10, 30, 42, 436, 2636 → 6
        //   bin 1: 3972, 5638 → 2
        //   bin 2: 7554, 9231 → 2
        //   bin 3: 11486, 12329 → 2
        //   bin 4: 15536, 17470 → 2
        //   bin 5: (empty) → null
        //   bin 6: 22070, 23269 → 2
        //   bin 7: 25733, 27309, 28054 → 3
        expect(rows[0].bin).toBe(0);
        expect(rows[0].count).toBe(6);

        expect(rows[1].bin).toBe(1);
        expect(rows[1].count).toBe(2);

        expect(rows[5].bin).toBe(5);
        expect(rows[5].count).toBeNull();

        expect(rows[7].bin).toBe(7);
        expect(rows[7].count).toBe(3);

        for (const row of rows) {
            expect(row.bin_width).toBeCloseTo(3505.5, 1);
        }

        expect(rows[0].bin_lb).toBeCloseTo(10, 1);
        expect(rows[0].bin_ub).toBeCloseTo(3515.5, 1);
        expect(rows[7].bin_lb).toBeCloseTo(24548.5, 1);
        expect(rows[7].bin_ub).toBeCloseTo(28054, 1);
    });

    it('projection', async () => {
        const table = arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            name: ['Alice', 'Bob', 'Charlie'],
            score: new Float64Array([85, 90, 95]),
        });
        await conn.insertArrowTable(table, { name: 'input', create: true });

        const sql = SQLFrame.from("input")
            .project(["id", "name"])
            .toSQL();
        const result = await conn.query(sql);

        expect(result.numCols).toBe(2);
        const rows = toPlainObjects(result);
        expect(rows).toEqual([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Charlie' },
        ]);
    });
});
