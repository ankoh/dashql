import { describe, expect, it, vi } from 'vitest';

import { reportWorkbookOutcomes, WORKBOOK_STATUS_LOG_TARGET, WorkbookStatusStore } from './workbook_status_store.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import { TestLogger } from '@ankoh/dashql/platform/testing/test_logger';
import { LogLevel } from '@ankoh/dashql/platform/platform/logger/log_buffer';

function status(key: string, tone = WorkbookStatusTone.Progress, extra: Partial<WorkbookStatus> = {}): WorkbookStatus {
    return { key, source: WorkbookStatusSource.Query, tone, text: key, at: 1, ...extra };
}

describe('Workbook status store', () => {
    it('merges the live statuses of the sources of a workbook and keeps the snapshot until they change', () => {
        const store = new WorkbookStatusStore();
        const listener = vi.fn();
        store.subscribe(listener);
        expect(store.snapshot('w1')).toEqual({ live: [], outcome: null, status: null, busy: false });
        store.setLive('w1', 'queries', [status('q')]);
        store.setLive('w1', 'files', [status('f', WorkbookStatusTone.Attention)]);
        const snapshot = store.snapshot('w1');
        expect(snapshot.live.map(s => s.key)).toEqual(['q', 'f']);
        expect(snapshot.busy).toBe(true);
        expect(snapshot.status?.key).toBe('q');
        expect(listener).toHaveBeenCalledTimes(2);
        // The same statuses at another time change nothing
        store.setLive('w1', 'queries', [{ ...status('q'), at: 2 }]);
        expect(store.snapshot('w1')).toBe(snapshot);
        expect(listener).toHaveBeenCalledTimes(2);
        store.setLive('w1', 'queries', []);
        expect(store.snapshot('w1').live.map(s => s.key)).toEqual(['f']);
        expect(store.snapshot('w2').status).toBeNull();
    });

    it('logs the outcomes of a workbook to the log of the app, the newest is the outcome of the bar', () => {
        const store = new WorkbookStatusStore();
        const logger = new TestLogger();
        reportWorkbookOutcomes(store, logger, 'w1', [
            status('1_orders ran', WorkbookStatusTone.Success, { detail: 'in 12 ms', scriptKey: 1 }),
            status('2_revenue failed', WorkbookStatusTone.Failed, { detail: 'no such table' }),
        ]);
        const records = [0, 1].map(i => logger.buffer.at(i)!);
        expect(records.map(r => [r.level, r.target, r.message, r.keyValues])).toEqual([
            [LogLevel.Info, WORKBOOK_STATUS_LOG_TARGET, '1_orders ran', { workbookId: 'w1', source: 'query', detail: 'in 12 ms', scriptKey: '1' }],
            [LogLevel.Warn, WORKBOOK_STATUS_LOG_TARGET, '2_revenue failed', { workbookId: 'w1', source: 'query', detail: 'no such table', scriptKey: undefined }],
        ]);
        expect(store.snapshot('w1').status?.text).toBe('2_revenue failed');
        // What runs comes before the outcome
        store.setLive('w1', 'queries', [status('Running 3_more')]);
        expect(store.snapshot('w1').status?.text).toBe('Running 3_more');
    });
});
