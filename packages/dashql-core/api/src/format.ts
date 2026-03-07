import * as buffers from './buffers.js';
import { findTokensAtLocation } from './tokens.js';

export function formatQualifiedTableName(q: buffers.analyzer.QualifiedTableName): string {
    const schema = q.schemaName();
    const table = q.tableName();
    if (!table) return '';
    if (schema) return `${schema}.${table}`;
    return table;
}

export function formatQualifiedColumnName(q: buffers.analyzer.QualifiedColumnName): string {
    const alias = q.tableAlias();
    const col = q.columnName();
    if (!col) return '';
    if (alias) return `${alias}.${col}`;
    return col;
}

export function formatQualifiedFunctionName(q: buffers.analyzer.QualifiedFunctionName): string {
    const schema = q.schemaName();
    const fn = q.functionName();
    if (!fn) return '';
    if (schema) return `${schema}.${fn}`;
    return fn;
}

export interface ColumnFilterSummary {
    filterText: string;
    columnRefStart: number;
    columnRefLength: number;
}

export function columnFilterFromText(
    scriptText: string,
    scanned: buffers.parser.ScannedScript,
    analyzed: buffers.analyzer.AnalyzedScript,
    filter: buffers.analyzer.ColumnFilter,
    tmpExpr: buffers.algebra.Expression,
): ColumnFilterSummary | null {
    const filterLoc = filter.location();
    const colExpr = analyzed.expressions(filter.columnReferenceExpressionId(), tmpExpr);
    if (!filterLoc || !colExpr?.location()) return null;
    const colLoc = colExpr.location()!;

    const tokens = scanned.tokens();
    if (!tokens) return null;
    const [filterFirst, filterEnd] = findTokensAtLocation(tokens, filterLoc);
    if (filterFirst >= filterEnd) return null;

    let filterText = '';
    let columnRefStart = 0;
    let columnRefLength = 0;
    let seenColStart = false;
    const colStart = colLoc.offset();
    const colEnd = colLoc.offset() + colLoc.length();

    for (let i = filterFirst; i < filterEnd; ++i) {
        const to = tokens.tokenOffsets(i) ?? 0;
        const tl = tokens.tokenLengths(i) ?? 0;
        const tokenEnd = to + tl;
        const overlapsCol = to < colEnd && tokenEnd > colStart;
        if (overlapsCol) {
            if (!seenColStart) {
                columnRefStart = filterText.length;
                seenColStart = true;
            }
            columnRefLength += tl;
        }
        filterText += scriptText.slice(to, to + tl);
    }

    if (columnRefLength <= 0) return { filterText, columnRefStart: 0, columnRefLength: 0 };
    return { filterText, columnRefStart, columnRefLength };
}
