import * as dashql from '../../../shared/core/index.js';
import {
    formatQualifiedTableName,
    formatQualifiedColumnName,
    formatQualifiedFunctionName,
} from '../../../shared/core/index.js';

import type { DashQLScriptBuffers } from './editor/dashql_processor.js';

/// Compact summary of an analyzed script for display in collapsed cards.
export interface ScriptSummary {
    tableRefs: string[];
    columnRefs: string[];
    tableDefs: string[];
    functionRefs: string[];
}

const EMPTY_SUMMARY: ScriptSummary = {
    tableRefs: [],
    columnRefs: [],
    tableDefs: [],
    functionRefs: [],
};

/// Build a compact summary from script processed buffers.
export function buildScriptSummary(processed: DashQLScriptBuffers): ScriptSummary {
    const analyzedPtr = processed.analyzed;
    if (!analyzedPtr) return EMPTY_SUMMARY;

    const analyzed = analyzedPtr.read();
    const tmpTableRef = new dashql.buffers.analyzer.TableReference();
    const tmpTable = new dashql.buffers.analyzer.Table();
    const tmpQualTable = new dashql.buffers.analyzer.QualifiedTableName();
    const tmpColRef = new dashql.buffers.algebra.ColumnRefExpression();
    const tmpQualCol = new dashql.buffers.analyzer.QualifiedColumnName();
    const tmpExpr = new dashql.buffers.algebra.Expression();
    const tmpFuncRef = new dashql.buffers.analyzer.FunctionReference();
    const tmpQualFunc = new dashql.buffers.analyzer.QualifiedFunctionName();

    const tableRefs = new Set<string>();
    for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
        const ref = analyzed.tableReferences(i, tmpTableRef)!;
        const name = ref.tableName(tmpQualTable);
        if (name) {
            const s = formatQualifiedTableName(name);
            if (s) tableRefs.add(s);
        }
    }

    const columnRefs = new Set<string>();
    for (let i = 0; i < analyzed.expressionsLength(); ++i) {
        const expr = analyzed.expressions(i, tmpExpr)!;
        if (expr.innerType() === dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression) {
            const colRef = expr.inner(tmpColRef)!;
            const name = colRef.columnName(tmpQualCol);
            if (name) {
                const s = formatQualifiedColumnName(name);
                if (s) columnRefs.add(s);
            }
        }
    }

    const tableDefs = new Set<string>();
    for (let i = 0; i < analyzed.tablesLength(); ++i) {
        const table = analyzed.tables(i, tmpTable)!;
        const name = table.tableName(tmpQualTable);
        if (name) {
            const s = formatQualifiedTableName(name);
            if (s) tableDefs.add(s);
        }
    }

    const functionRefs = new Set<string>();
    for (let i = 0; i < analyzed.functionReferencesLength(); ++i) {
        const ref = analyzed.functionReferences(i, tmpFuncRef)!;
        const name = ref.functionName(tmpQualFunc);
        if (name) {
            const s = formatQualifiedFunctionName(name);
            if (s) functionRefs.add(s);
        }
    }

    return {
        tableRefs: [...tableRefs].sort(),
        columnRefs: [...columnRefs].sort(),
        tableDefs: [...tableDefs].sort(),
        functionRefs: [...functionRefs].sort(),
    };
}
