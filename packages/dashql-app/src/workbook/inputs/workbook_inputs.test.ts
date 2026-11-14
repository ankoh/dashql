import * as core from '@ankoh/dashql-core';
import { describe, expect, it } from 'vitest';

import { affectedScriptIndices, readWorkbookInputType, workbookInputControl, WorkbookInputControl, type WorkbookInputType } from '@ankoh/dashql-sdk/workbook/inputs/workbook_inputs';

const Kind = core.buffers.analyzer.SqlTypeKind;
const EdgeKind = core.buffers.execution.DataflowEdgeKind;

function type(kind: core.buffers.analyzer.SqlTypeKind, cast = true, sql = 'type'): WorkbookInputType {
    return { kind, sql, arrayDimensions: 0, withTimeZone: false, cast, known: true };
}

function edge(fromScript: number, toScript: number, kind: core.buffers.execution.DataflowEdgeKind) {
    return { fromScript, fromStatement: 0, toScript, toStatement: 0, kind, name: '' };
}

describe('workbook inputs', () => {
    it('picks the control of an input from its type', () => {
        expect(workbookInputControl(type(Kind.INT4))).toBe(WorkbookInputControl.Integer);
        expect(workbookInputControl(type(Kind.INT8, false))).toBe(WorkbookInputControl.Number);
        expect(workbookInputControl(type(Kind.NUMERIC))).toBe(WorkbookInputControl.Number);
        expect(workbookInputControl(type(Kind.BOOL))).toBe(WorkbookInputControl.Boolean);
        expect(workbookInputControl(type(Kind.DATE))).toBe(WorkbookInputControl.Date);
        expect(workbookInputControl(type(Kind.TIMESTAMP))).toBe(WorkbookInputControl.Timestamp);
        expect(workbookInputControl(type(Kind.INTERVAL, false))).toBe(WorkbookInputControl.Interval);
        expect(workbookInputControl(type(Kind.TEXT))).toBe(WorkbookInputControl.Text);
        expect(workbookInputControl({ ...type(Kind.INT4), arrayDimensions: 1 })).toBe(WorkbookInputControl.Text);
    });

    it('reruns the scripts that use an input and the scripts downstream of them', () => {
        const dataflow = {
            scripts: [],
            inputs: [{ name: 'min' }, { name: 'region' }],
            edges: [
                edge(0, 1, EdgeKind.INPUT),
                edge(1, 3, EdgeKind.INPUT),
                edge(1, 2, EdgeKind.INLINE_REFERENCE),
                edge(2, 4, EdgeKind.TABLE),
                edge(4, 5, EdgeKind.INVALID_REFERENCE),
                edge(0, 6, EdgeKind.SCAN_REFERENCE),
            ],
        } as unknown as core.buffers.execution.SessionDataflowT;
        expect(affectedScriptIndices(dataflow, ['min'])).toEqual([1, 2, 4]);
        expect(affectedScriptIndices(dataflow, ['region'])).toEqual([3]);
        expect(affectedScriptIndices(dataflow, ['min', 'region'])).toEqual([1, 2, 3, 4]);
        expect(affectedScriptIndices(dataflow, ['nope'])).toEqual([]);
    });

    it('leaves out the scripts that run only on request, but not the scripts downstream of them', () => {
        const dataflow = {
            scripts: [{}, { manual: true }, {}],
            inputs: [{ name: 'min' }],
            edges: [
                edge(0, 1, EdgeKind.INPUT),
                edge(1, 2, EdgeKind.INLINE_REFERENCE),
            ],
        } as unknown as core.buffers.execution.SessionDataflowT;
        expect(affectedScriptIndices(dataflow, ['min'])).toEqual([2]);
    });
});

describe('the type of a workbook input', () => {
    const Source = core.buffers.execution.SessionInputTypeSource;

    it('reads the type of a cast', () => {
        const sqlType = Object.assign(new core.buffers.analyzer.SqlTypeT(), { kind: Kind.TIMESTAMP, sql: 'timestamp with time zone', arrayDimensions: 1, withTimeZone: true });
        expect(readWorkbookInputType(sqlType, Source.CAST)).toEqual({
            kind: Kind.TIMESTAMP,
            sql: 'timestamp with time zone',
            arrayDimensions: 1,
            withTimeZone: true,
            cast: true,
            known: true,
        });
    });

    it('knows the type of a literal but not of an input without one', () => {
        const sqlType = Object.assign(new core.buffers.analyzer.SqlTypeT(), { kind: Kind.INT4, sql: 'integer' });
        expect(readWorkbookInputType(sqlType, Source.LITERAL)).toMatchObject({ kind: Kind.INT4, cast: false, known: true });
        expect(readWorkbookInputType(null, Source.NONE)).toEqual({
            kind: Kind.TEXT,
            sql: 'text',
            arrayDimensions: 0,
            withTimeZone: false,
            cast: false,
            known: false,
        });
    });
});
