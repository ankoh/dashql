import { SQLFrame } from './sqlframe_builder.js';

describe('SQLFrame SQL generation', () => {
    it('empty transform', () => {
        const sql = SQLFrame.from("t").toSQL();
        expect(sql).toBe('SELECT * FROM "t"');
    });

    it('row number', () => {
        const sql = SQLFrame.from("t").rowNumber("rn").toSQL();
        expect(sql).toBe(
            `WITH\n` +
            `  __rownumber AS (\n` +
            `    SELECT *, row_number() OVER () AS "rn" FROM "t"\n` +
            `  )\n` +
            `SELECT * FROM __rownumber`
        );
    });

    it('single value identifier', () => {
        const sql = SQLFrame.from("t").valueIdentifier("category", "cat_id").toSQL();
        expect(sql).toBe(
            `WITH\n` +
            `  __value_ids AS (\n` +
            `    SELECT *, dense_rank() OVER (ORDER BY "category" ASC NULLS LAST) AS "cat_id" FROM "t"\n` +
            `  )\n` +
            `SELECT * FROM __value_ids`
        );
    });

    it('multiple value identifiers fold into one SELECT', () => {
        const sql = SQLFrame.from("t")
            .valueIdentifier("category", "cat_id")
            .valueIdentifier("region", "reg_id")
            .toSQL();
        expect(sql).toBe(
            `WITH\n` +
            `  __value_ids AS (\n` +
            `    SELECT *, dense_rank() OVER (ORDER BY "category" ASC NULLS LAST) AS "cat_id", ` +
            `dense_rank() OVER (ORDER BY "region" ASC NULLS LAST) AS "reg_id" FROM "t"\n` +
            `  )\n` +
            `SELECT * FROM __value_ids`
        );
    });

    it('binning', () => {
        const sql = SQLFrame.from("t").binning({
            fieldName: "price",
            statsTable: "stats",
            statsMinField: "min_price",
            statsMaxField: "max_price",
            binCount: 8,
            outputAlias: "bin",
        }).toSQL();
        expect(sql).toContain('CROSS JOIN');
        expect(sql).toContain('CAST(t."price" AS DOUBLE)');
        expect(sql).toContain('__bin_width');
        expect(sql).toContain('AS "bin"');
        expect(sql).toContain('GREATEST');
    });

    it('scalar filter', () => {
        const sql = SQLFrame.from("t")
            .filter("score", ">=", 10)
            .filter("score", "<=", 20)
            .toSQL();
        expect(sql).toBe(
            `WITH\n` +
            `  __filtered AS (\n` +
            `    SELECT * FROM "t" WHERE "score" >= 10 AND "score" <= 20\n` +
            `  )\n` +
            `SELECT * FROM __filtered`
        );
    });

    it('semi-join filter', () => {
        const sql = SQLFrame.from("t")
            .semiJoinFilter("id", "filter_tbl", "fid")
            .toSQL();
        expect(sql).toBe(
            `WITH\n` +
            `  __semi_0 AS (\n` +
            `    SELECT * FROM "t" WHERE "id" IN (SELECT "fid" FROM "filter_tbl")\n` +
            `  )\n` +
            `SELECT * FROM __semi_0`
        );
    });

    it('simple group by', () => {
        const sql = SQLFrame.from("t").groupBy({
            keys: [{ fieldName: "category", outputAlias: "key" }],
            aggregates: [{ func: "count_star", outputAlias: "cnt" }],
        }).toSQL();
        expect(sql).toContain('"category" AS "key"');
        expect(sql).toContain('COUNT(*) AS "cnt"');
        expect(sql).toContain('GROUP BY 1');
    });

    it('global aggregation (no keys)', () => {
        const sql = SQLFrame.from("t").groupBy({
            keys: [],
            aggregates: [
                { func: "min", fieldName: "score", outputAlias: "min_score" },
                { func: "max", fieldName: "score", outputAlias: "max_score" },
            ],
        }).toSQL();
        expect(sql).toContain('MIN("score") AS "min_score"');
        expect(sql).toContain('MAX("score") AS "max_score"');
        expect(sql).not.toContain('GROUP BY');
    });

    it('binned group by', () => {
        const sql = SQLFrame.from("t").groupBy({
            keys: [{
                fieldName: "price",
                outputAlias: "bin",
                binning: {
                    binCount: 8,
                    statsTable: "stats",
                    statsMinField: "min_val",
                    statsMaxField: "max_val",
                    outputBinWidthAlias: "bin_width",
                    outputBinLbAlias: "bin_lb",
                    outputBinUbAlias: "bin_ub",
                    includeNullBin: true,
                },
            }],
            aggregates: [{ func: "count_star", outputAlias: "count" }],
        }).toSQL();
        expect(sql).toContain('__grp_stats');
        expect(sql).toContain('__grouped');
        expect(sql).toContain('__all_bins');
        expect(sql).toContain('__with_bins');
        expect(sql).toContain('__bin_meta');
        expect(sql).toContain('generate_series(0, 8)');
        expect(sql).toContain('WHEN t."price" IS NULL THEN 8');
        expect(sql).toContain('AS "bin_width"');
        expect(sql).toContain('AS "bin_lb"');
        expect(sql).toContain('AS "bin_ub"');
    });

    it('binned group by without null bin', () => {
        const sql = SQLFrame.from("t").groupBy({
            keys: [{
                fieldName: "price",
                outputAlias: "bin",
                binning: {
                    binCount: 4,
                    statsTable: "stats",
                    statsMinField: "mn",
                    statsMaxField: "mx",
                    outputBinWidthAlias: "w",
                    outputBinLbAlias: "lb",
                    outputBinUbAlias: "ub",
                    includeNullBin: false,
                },
            }],
            aggregates: [{ func: "count_star", outputAlias: "cnt" }],
        }).toSQL();
        expect(sql).toContain('generate_series(0, 3)');
        expect(sql).not.toContain('IS NULL THEN');
        expect(sql).not.toContain('CASE WHEN "bin" =');
    });

    it('order by ASC/DESC with NULLS', () => {
        const sql = SQLFrame.from("t")
            .orderBy([
                { field: "a", ascending: true, nullsFirst: false },
                { field: "b", ascending: false, nullsFirst: true },
            ])
            .toSQL();
        expect(sql).toBe(
            `SELECT * FROM "t"\n` +
            `ORDER BY "a" ASC NULLS LAST, "b" DESC NULLS FIRST`
        );
    });

    it('order by with limit', () => {
        const sql = SQLFrame.from("t")
            .orderBy([{ field: "x" }], 50)
            .toSQL();
        expect(sql).toBe(
            `SELECT * FROM "t"\n` +
            `ORDER BY "x" ASC NULLS LAST\n` +
            `LIMIT 50`
        );
    });

    it('projection', () => {
        const sql = SQLFrame.from("t")
            .project(["id", "name"])
            .toSQL();
        expect(sql).toBe('SELECT "id", "name" FROM "t"');
    });

    it('combined: row_number + filter + order + projection', () => {
        const sql = SQLFrame.from("input")
            .rowNumber("rn")
            .filter("score", ">=", 10)
            .orderBy([{ field: "rn" }])
            .project(["rn"])
            .toSQL();

        expect(sql).toContain('__rownumber');
        expect(sql).toContain('__filtered');
        expect(sql).toContain('SELECT "rn" FROM __filtered');
        expect(sql).toContain('ORDER BY "rn" ASC NULLS LAST');
    });

    it('quotes identifiers with special characters', () => {
        const sql = SQLFrame.from("my table")
            .rowNumber("row num")
            .toSQL();
        expect(sql).toContain('"my table"');
        expect(sql).toContain('"row num"');
    });

    it('escapes double quotes in identifiers', () => {
        const sql = SQLFrame.from('a"b').toSQL();
        expect(sql).toBe('SELECT * FROM "a""b"');
    });
});
