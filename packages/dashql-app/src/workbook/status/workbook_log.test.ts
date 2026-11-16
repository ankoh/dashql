import { describe, expect, it } from 'vitest';

import { isWorkbookLogRecord } from './workbook_log.js';
import { testLogRecord } from '@akohn/dashql/platform/testing/test_logger';

describe('Workbook log', () => {
    it('takes the records that name the workbook and the records of the traces of its queries', () => {
        const traces = new Set([7]);
        expect(isWorkbookLogRecord(testLogRecord({ keyValues: { workbookId: 'w1' } }), 'w1', traces)).toBe(true);
        expect(isWorkbookLogRecord(testLogRecord({ keyValues: { workbookId: 'w2' } }), 'w1', traces)).toBe(false);
        expect(isWorkbookLogRecord(testLogRecord({ tracing: { traceId: 7, spanId: 1, parentSpanId: null } }), 'w1', traces)).toBe(true);
        expect(isWorkbookLogRecord(testLogRecord({ tracing: { traceId: 8, spanId: 1, parentSpanId: null } }), 'w1', traces)).toBe(false);
        // Another key for the workbook does not count
        expect(isWorkbookLogRecord(testLogRecord({ keyValues: { workbook: 'w1' } }), 'w1', traces)).toBe(false);
    });
});
