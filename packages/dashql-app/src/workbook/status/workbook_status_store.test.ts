import { describe, expect, it, vi } from 'vitest';

import { WORKBOOK_LOG_LIMIT, WorkbookStatusStore } from './workbook_status_store.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';

function status(key: string, tone = WorkbookStatusTone.Progress, at = 1): WorkbookStatus {
    return { key, source: WorkbookStatusSource.Query, tone, text: key, at };
}

describe('Workbook status store', () => {
    it('merges the live statuses of the sources of a workbook and keeps the snapshot until they change', () => {
        const store = new WorkbookStatusStore();
        const listener = vi.fn();
        store.subscribe(listener);
        expect(store.snapshot('w1')).toEqual({ live: [], log: [], status: null, busy: false });
        store.setLive('w1', 'queries', [status('q')]);
        store.setLive('w1', 'files', [status('f', WorkbookStatusTone.Attention)]);
        const snapshot = store.snapshot('w1');
        expect(snapshot.live.map(s => s.key)).toEqual(['q', 'f']);
        expect(snapshot.busy).toBe(true);
        expect(snapshot.status?.key).toBe('q');
        expect(listener).toHaveBeenCalledTimes(2);
        // The same statuses at another time change nothing
        store.setLive('w1', 'queries', [status('q', WorkbookStatusTone.Progress, 2)]);
        expect(store.snapshot('w1')).toBe(snapshot);
        expect(listener).toHaveBeenCalledTimes(2);
        store.setLive('w1', 'queries', []);
        expect(store.snapshot('w1').live.map(s => s.key)).toEqual(['f']);
        expect(store.snapshot('w2').status).toBeNull();
    });

    it('logs every step of the live statuses, the bar tells only how things ended', () => {
        const store = new WorkbookStatusStore();
        const running = (detail: string): WorkbookStatus => ({ ...status('q'), detail });
        store.setLive('w1', 'queries', [running('Preparing query')], 10);
        store.setLive('w1', 'queries', [running('Preparing query')], 11);
        store.setLive('w1', 'queries', [running('Executing query')], 12);
        store.setLive('w1', 'queries', [], 13);
        const log = store.snapshot('w1').log;
        expect(log.map(line => [line.detail, line.at, line.progress])).toEqual([['Preparing query', 10, true], ['Executing query', 12, true]]);
        expect(new Set(log.map(line => line.key)).size).toBe(2);
        // A step is not how a query ended, nothing is left to tell
        expect(store.snapshot('w1').status).toBeNull();
        store.push('w1', [status('done', WorkbookStatusTone.Success)]);
        expect(store.snapshot('w1').status?.key).toBe('done');
    });

    it('keeps the newest lines of the log', () => {
        const store = new WorkbookStatusStore();
        for (let i = 0; i < WORKBOOK_LOG_LIMIT + 5; ++i) store.push('w1', [status(`l${i}`, WorkbookStatusTone.Success)]);
        const log = store.snapshot('w1').log;
        expect(log).toHaveLength(WORKBOOK_LOG_LIMIT);
        expect(log[log.length - 1].key).toBe(`l${WORKBOOK_LOG_LIMIT + 4}`);
        expect(store.snapshot('w1').status?.key).toBe(`l${WORKBOOK_LOG_LIMIT + 4}`);
    });
});
