export type FilterOp = "=" | "<" | "<=" | ">" | ">=";

export type AggFunc = "min" | "max" | "avg" | "count" | "count_star";

export interface OrderByConstraint {
    field: string;
    ascending?: boolean;
    nullsFirst?: boolean;
}

export interface BinningConfig {
    fieldName: string;
    statsTable: string;
    statsMinField: string;
    statsMaxField: string;
    binCount: number;
    outputAlias: string;
    toNumericFn?: string;
}

export interface GroupByKey {
    fieldName: string;
    outputAlias: string;
    binning?: GroupByKeyBinning;
}

export interface GroupByKeyBinning {
    preBinnedFieldName?: string;
    binCount: number;
    statsTable: string;
    statsMinField: string;
    statsMaxField: string;
    outputBinLbAlias: string;
    outputBinUbAlias: string;
    outputBinWidthAlias: string;
    includeNullBin?: boolean;
    toNumericFn?: string;
}

export interface GroupByAggregate {
    fieldName?: string;
    outputAlias: string;
    func: AggFunc;
    distinct?: boolean;
}

export interface GroupByConfig {
    keys: GroupByKey[];
    aggregates: GroupByAggregate[];
}

export interface ScalarFilter {
    fieldName: string;
    op: FilterOp;
    value: number;
}

export interface SemiJoinFilter {
    fieldName: string;
    tableName: string;
    joinFieldName: string;
}

interface ValueIdentifierEntry {
    fieldName: string;
    outputAlias: string;
}

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function formatLiteral(value: number): string {
    return value.toString();
}

function toNumeric(expr: string, fn?: string): string {
    return fn ? `${fn}(${expr})` : `CAST(${expr} AS DOUBLE)`;
}

function formatAggExpr(agg: GroupByAggregate): string {
    switch (agg.func) {
        case "min":
            return `MIN(${quoteIdent(agg.fieldName!)})`;
        case "max":
            return `MAX(${quoteIdent(agg.fieldName!)})`;
        case "avg":
            return `AVG(${quoteIdent(agg.fieldName!)})`;
        case "count":
            if (agg.distinct) {
                return `COUNT(DISTINCT ${quoteIdent(agg.fieldName!)})`;
            }
            return `COUNT(${quoteIdent(agg.fieldName!)})`;
        case "count_star":
            return `COUNT(*)`;
    }
}

function formatOrderByItem(c: OrderByConstraint): string {
    const dir = (c.ascending ?? true) ? "ASC" : "DESC";
    const nulls = (c.nullsFirst ?? false) ? "NULLS FIRST" : "NULLS LAST";
    return `${quoteIdent(c.field)} ${dir} ${nulls}`;
}

export class SQLFrame {
    private _inputTable: string;
    private _rowNumber: string | null = null;
    private _valueIdentifiers: ValueIdentifierEntry[] = [];
    private _binnings: BinningConfig[] = [];
    private _scalarFilters: ScalarFilter[] = [];
    private _semiJoinFilters: SemiJoinFilter[] = [];
    private _groupBy: GroupByConfig | null = null;
    private _orderBy: OrderByConstraint[] | null = null;
    private _limit: number | undefined = undefined;
    private _projection: string[] | null = null;

    private constructor(inputTable: string) {
        this._inputTable = inputTable;
    }

    static from(inputTable: string): SQLFrame {
        return new SQLFrame(inputTable);
    }

    rowNumber(outputAlias: string): SQLFrame {
        this._rowNumber = outputAlias;
        return this;
    }

    valueIdentifier(fieldName: string, outputAlias: string): SQLFrame {
        this._valueIdentifiers.push({ fieldName, outputAlias });
        return this;
    }

    binning(config: BinningConfig): SQLFrame {
        this._binnings.push(config);
        return this;
    }

    filter(fieldName: string, op: FilterOp, value: number): SQLFrame {
        this._scalarFilters.push({ fieldName, op, value });
        return this;
    }

    semiJoinFilter(fieldName: string, tableName: string, joinFieldName: string): SQLFrame {
        this._semiJoinFilters.push({ fieldName, tableName, joinFieldName });
        return this;
    }

    groupBy(config: GroupByConfig): SQLFrame {
        this._groupBy = config;
        return this;
    }

    orderBy(constraints: OrderByConstraint[], limit?: number): SQLFrame {
        this._orderBy = constraints;
        this._limit = limit;
        return this;
    }

    project(fields: string[]): SQLFrame {
        this._projection = fields;
        return this;
    }

    toSQL(): string {
        const ctes: string[] = [];
        let prev = quoteIdent(this._inputTable);

        // 1. RowNumber
        if (this._rowNumber !== null) {
            const cteName = "__rownumber";
            const body = `SELECT *, row_number() OVER () AS ${quoteIdent(this._rowNumber)} FROM ${prev}`;
            ctes.push(`${cteName} AS (\n    ${body}\n  )`);
            prev = cteName;
        }

        // 2. ValueIdentifiers
        if (this._valueIdentifiers.length > 0) {
            const cteName = "__value_ids";
            const windowExprs = this._valueIdentifiers.map(vi =>
                `dense_rank() OVER (ORDER BY ${quoteIdent(vi.fieldName)} ASC NULLS LAST) AS ${quoteIdent(vi.outputAlias)}`
            );
            const body = `SELECT *, ${windowExprs.join(", ")} FROM ${prev}`;
            ctes.push(`${cteName} AS (\n    ${body}\n  )`);
            prev = cteName;
        }

        // 3. Binning
        if (this._binnings.length > 0) {
            const cteName = "__binning";
            const binExprs: string[] = [];
            const statsJoins: string[] = [];

            for (let idx = 0; idx < this._binnings.length; idx++) {
                const b = this._binnings[idx];
                const fn = b.toNumericFn;
                const alias = `__bs${idx}`;
                const sub =
                    `SELECT ` +
                    `${toNumeric(quoteIdent(b.statsMinField), fn)} AS __min, ` +
                    `GREATEST(ABS(${toNumeric(quoteIdent(b.statsMaxField), fn)} - ${toNumeric(quoteIdent(b.statsMinField), fn)}) / ${b.binCount}, 1e-15) AS __bin_width ` +
                    `FROM ${quoteIdent(b.statsTable)}`;
                statsJoins.push(`CROSS JOIN (${sub}) ${alias}`);
                binExprs.push(
                    `(${toNumeric(`t.${quoteIdent(b.fieldName)}`, fn)} - ${alias}.__min) / ${alias}.__bin_width AS ${quoteIdent(b.outputAlias)}`
                );
            }

            const body = `SELECT t.*, ${binExprs.join(", ")} FROM ${prev} t ${statsJoins.join(" ")}`;
            ctes.push(`${cteName} AS (\n    ${body}\n  )`);
            prev = cteName;
        }

        // 4. Filters (scalar)
        if (this._scalarFilters.length > 0) {
            const cteName = "__filtered";
            const conditions = this._scalarFilters.map(f =>
                `${quoteIdent(f.fieldName)} ${f.op} ${formatLiteral(f.value)}`
            );
            const body = `SELECT * FROM ${prev} WHERE ${conditions.join(" AND ")}`;
            ctes.push(`${cteName} AS (\n    ${body}\n  )`);
            prev = cteName;
        }

        // 4b. Filters (semi-join)
        for (let i = 0; i < this._semiJoinFilters.length; i++) {
            const sj = this._semiJoinFilters[i];
            const cteName = `__semi_${i}`;
            const body = `SELECT * FROM ${prev} WHERE ${quoteIdent(sj.fieldName)} IN (SELECT ${quoteIdent(sj.joinFieldName)} FROM ${quoteIdent(sj.tableName)})`;
            ctes.push(`${cteName} AS (\n    ${body}\n  )`);
            prev = cteName;
        }

        // 5. GroupBy
        if (this._groupBy !== null) {
            const gb = this._groupBy;
            let binnedKey: { key: GroupByKey; binning: GroupByKeyBinning } | null = null;

            for (const key of gb.keys) {
                if (key.binning) {
                    binnedKey = { key, binning: key.binning };
                    break;
                }
            }

            if (binnedKey !== null) {
                prev = this._buildBinnedGroupBy(ctes, prev, gb, binnedKey.key, binnedKey.binning);
            } else {
                prev = this._buildSimpleGroupBy(ctes, prev, gb);
            }
        }

        // Final SELECT
        const selectCols = this._projection
            ? this._projection.map(f => quoteIdent(f)).join(", ")
            : "*";

        let finalSelect = `SELECT ${selectCols} FROM ${prev}`;

        // 6. OrderBy
        if (this._orderBy !== null && this._orderBy.length > 0) {
            finalSelect += `\nORDER BY ${this._orderBy.map(formatOrderByItem).join(", ")}`;
        }

        // 6b. Limit
        if (this._limit !== undefined) {
            finalSelect += `\nLIMIT ${this._limit}`;
        }

        if (ctes.length === 0) {
            return finalSelect;
        }
        return `WITH\n  ${ctes.join(",\n  ")}\n${finalSelect}`;
    }

    private _buildSimpleGroupBy(ctes: string[], prev: string, gb: GroupByConfig): string {
        const cteName = "__grouped";
        const keyExprs = gb.keys.map(k => `${quoteIdent(k.fieldName)} AS ${quoteIdent(k.outputAlias)}`);
        const aggExprs = gb.aggregates.map(a => `${formatAggExpr(a)} AS ${quoteIdent(a.outputAlias)}`);
        const selectList = [...keyExprs, ...aggExprs].join(", ");
        const groupByPositions = gb.keys.map((_, i) => i + 1).join(", ");
        const body = gb.keys.length > 0
            ? `SELECT ${selectList} FROM ${prev} GROUP BY ${groupByPositions}`
            : `SELECT ${selectList} FROM ${prev}`;
        ctes.push(`${cteName} AS (\n    ${body}\n  )`);
        return cteName;
    }

    private _buildBinnedGroupBy(
        ctes: string[],
        prev: string,
        gb: GroupByConfig,
        binnedKeyDef: GroupByKey,
        binning: GroupByKeyBinning,
    ): string {
        const binCount = binning.binCount;
        const includeNullBin = binning.includeNullBin ?? false;
        const totalBins = includeNullBin ? binCount + 1 : binCount;
        const binAlias = binnedKeyDef.outputAlias;
        const fn = binning.toNumericFn;

        // Stats CTE: when toNumericFn is set, keep __min in the original type for
        // bounds and compute __bin_width via the numeric conversion function.
        const statsCteName = "__grp_stats";
        const minField = quoteIdent(binning.statsMinField);
        const maxField = quoteIdent(binning.statsMaxField);
        const statsSql = fn
            ? `SELECT ` +
              `${minField} AS __min, ` +
              `GREATEST(ABS(${fn}(${maxField}) - ${fn}(${minField})) / ${binCount}, 1e-15) AS __bin_width ` +
              `FROM ${quoteIdent(binning.statsTable)}`
            : `SELECT ` +
              `CAST(${minField} AS DOUBLE) AS __min, ` +
              `GREATEST(ABS(CAST(${maxField} AS DOUBLE) - CAST(${minField} AS DOUBLE)) / ${binCount}, 1e-15) AS __bin_width ` +
              `FROM ${quoteIdent(binning.statsTable)}`;
        ctes.push(`${statsCteName} AS (\n    ${statsSql}\n  )`);

        // Bin expression
        let binExpr: string;
        if (binning.preBinnedFieldName) {
            binExpr = `t.${quoteIdent(binning.preBinnedFieldName)}`;
        } else {
            binExpr = fn
                ? `(${fn}(t.${quoteIdent(binnedKeyDef.fieldName)}) - ${fn}(s.__min)) / s.__bin_width`
                : `(CAST(t.${quoteIdent(binnedKeyDef.fieldName)} AS DOUBLE) - s.__min) / s.__bin_width`;
        }

        // Clamped bin: CASE WHEN ... END
        let binCaseExpr: string;
        const flooredBin = `CAST(FLOOR(${binExpr}) AS INTEGER)`;
        if (includeNullBin) {
            binCaseExpr =
                `CASE ` +
                `WHEN t.${quoteIdent(binnedKeyDef.fieldName)} IS NULL THEN ${binCount} ` +
                `WHEN ${flooredBin} >= ${binCount} THEN ${binCount - 1} ` +
                `ELSE ${flooredBin} ` +
                `END`;
        } else {
            binCaseExpr =
                `CASE ` +
                `WHEN ${flooredBin} >= ${binCount} THEN ${binCount - 1} ` +
                `ELSE ${flooredBin} ` +
                `END`;
        }

        // Build key exprs and agg exprs
        const keyExprs: string[] = [];
        for (const key of gb.keys) {
            if (key === binnedKeyDef) {
                keyExprs.push(`${binCaseExpr} AS ${quoteIdent(binAlias)}`);
            } else {
                keyExprs.push(`${quoteIdent(key.fieldName)} AS ${quoteIdent(key.outputAlias)}`);
            }
        }
        const aggExprs = gb.aggregates.map(a => `${formatAggExpr(a)} AS ${quoteIdent(a.outputAlias)}`);
        const selectList = [...keyExprs, ...aggExprs].join(", ");
        const groupByPositions = gb.keys.map((_, i) => i + 1).join(", ");

        const groupedCteName = "__grouped";
        const groupedSql = `SELECT ${selectList} FROM ${prev} t CROSS JOIN ${statsCteName} s GROUP BY ${groupByPositions}`;
        ctes.push(`${groupedCteName} AS (\n    ${groupedSql}\n  )`);

        // All bins CTE
        const allBinsCteName = "__all_bins";
        const allBinsSql = `SELECT UNNEST(generate_series(0, ${totalBins - 1})) AS ${quoteIdent(binAlias)}`;
        ctes.push(`${allBinsCteName} AS (\n    ${allBinsSql}\n  )`);

        // Join missing bins
        const otherCols: string[] = [];
        for (const key of gb.keys) {
            if (key !== binnedKeyDef) {
                otherCols.push(`g.${quoteIdent(key.outputAlias)}`);
            }
        }
        for (const agg of gb.aggregates) {
            otherCols.push(`g.${quoteIdent(agg.outputAlias)}`);
        }

        const withBinsCteName = "__with_bins";
        const withBinsSelect = [`ab.${quoteIdent(binAlias)}`, ...otherCols].join(", ");
        const withBinsSql = `SELECT ${withBinsSelect} FROM ${allBinsCteName} ab LEFT JOIN ${groupedCteName} g ON ab.${quoteIdent(binAlias)} = g.${quoteIdent(binAlias)}`;
        ctes.push(`${withBinsCteName} AS (\n    ${withBinsSql}\n  )`);

        // Bin metadata CTE: when toNumericFn is set, __min is the original type
        // so we use interval arithmetic to produce bounds in the source type.
        const metaCteName = "__bin_meta";
        const widthAlias = binning.outputBinWidthAlias;
        const lbAlias = binning.outputBinLbAlias;
        const ubAlias = binning.outputBinUbAlias;
        const binRef = quoteIdent(binAlias);

        const offsetExpr = (offset: string) => fn
            ? `s.__min + (${offset}) * INTERVAL '1 second'`
            : `s.__min + (${offset})`;

        let widthExpr: string;
        let lbExpr: string;
        let ubExpr: string;

        if (includeNullBin) {
            widthExpr = `CASE WHEN ${binRef} = ${binCount} THEN NULL ELSE s.__bin_width END`;
            lbExpr = `CASE WHEN ${binRef} = ${binCount} THEN NULL ELSE ${offsetExpr(`${binRef} * s.__bin_width`)} END`;
            ubExpr = `CASE WHEN ${binRef} = ${binCount} THEN NULL ELSE ${offsetExpr(`(${binRef} + 1) * s.__bin_width`)} END`;
        } else {
            widthExpr = `s.__bin_width`;
            lbExpr = offsetExpr(`${binRef} * s.__bin_width`);
            ubExpr = offsetExpr(`(${binRef} + 1) * s.__bin_width`);
        }

        const metaSql =
            `SELECT t.*, ` +
            `${widthExpr} AS ${quoteIdent(widthAlias)}, ` +
            `${lbExpr} AS ${quoteIdent(lbAlias)}, ` +
            `${ubExpr} AS ${quoteIdent(ubAlias)} ` +
            `FROM ${withBinsCteName} t CROSS JOIN ${statsCteName} s`;
        ctes.push(`${metaCteName} AS (\n    ${metaSql}\n  )`);

        return metaCteName;
    }
}
