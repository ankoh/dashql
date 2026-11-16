import * as core from '../../core/index.js';
import { describe, expect, it } from 'vitest';

import { readWorkbookInputType, workbookInputControl, WorkbookInputControl, type WorkbookInputType } from './workbook_inputs.js';

const Kind = core.buffers.analyzer.SqlTypeKind;

function type(kind: core.buffers.analyzer.SqlTypeKind, cast = true, sql = 'type'): WorkbookInputType {
    return { kind, sql, arrayDimensions: 0, withTimeZone: false, cast, known: true };
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
});
