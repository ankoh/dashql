import * as core from '@ankoh/dashql-core';
import { describe, expect, it } from 'vitest';

import { affectedScriptIndices, readSessionInputType, sessionInputControl, SessionInputControl, type SessionInputType } from './session_inputs.js';

const Kind = core.buffers.analyzer.SqlTypeKind;
const EdgeKind = core.buffers.execution.DataflowEdgeKind;

function type(kind: core.buffers.analyzer.SqlTypeKind, cast = true, sql = 'type'): SessionInputType {
    return { kind, sql, arrayDimensions: 0, withTimeZone: false, cast, known: true };
}

function edge(fromScript: number, toScript: number, kind: core.buffers.execution.DataflowEdgeKind) {
    return { fromScript, fromStatement: 0, toScript, toStatement: 0, kind, name: '' };
}

describe('session inputs', () => {
    it('picks the control of an input from its type', () => {
        expect(sessionInputControl(type(Kind.INT4))).toBe(SessionInputControl.Integer);
        expect(sessionInputControl(type(Kind.INT8, false))).toBe(SessionInputControl.Number);
        expect(sessionInputControl(type(Kind.NUMERIC))).toBe(SessionInputControl.Number);
        expect(sessionInputControl(type(Kind.BOOL))).toBe(SessionInputControl.Boolean);
        expect(sessionInputControl(type(Kind.DATE))).toBe(SessionInputControl.Date);
        expect(sessionInputControl(type(Kind.TIMESTAMP))).toBe(SessionInputControl.Timestamp);
        expect(sessionInputControl(type(Kind.INTERVAL, false))).toBe(SessionInputControl.Interval);
        expect(sessionInputControl(type(Kind.TEXT))).toBe(SessionInputControl.Text);
        expect(sessionInputControl({ ...type(Kind.INT4), arrayDimensions: 1 })).toBe(SessionInputControl.Text);
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

describe('the type of a session input', () => {
    const Source = core.buffers.execution.SessionInputTypeSource;

    it('reads the type of a cast', () => {
        const sqlType = Object.assign(new core.buffers.analyzer.SqlTypeT(), { kind: Kind.TIMESTAMP, sql: 'timestamp with time zone', arrayDimensions: 1, withTimeZone: true });
        expect(readSessionInputType(sqlType, Source.CAST)).toEqual({
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
        expect(readSessionInputType(sqlType, Source.LITERAL)).toMatchObject({ kind: Kind.INT4, cast: false, known: true });
        expect(readSessionInputType(null, Source.NONE)).toEqual({
            kind: Kind.TEXT,
            sql: 'text',
            arrayDimensions: 0,
            withTimeZone: false,
            cast: false,
            known: false,
        });
    });
});
