import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettledBrushUpdates } from './histogram_cell.js';

describe('SettledBrushUpdates', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces continuous brush updates to the latest selection', () => {
        vi.useFakeTimers();
        const callback = vi.fn();
        const updates = new SettledBrushUpdates<number>();

        updates.schedule(1, callback);
        vi.advanceTimersByTime(100);
        updates.schedule(2, callback);
        vi.advanceTimersByTime(100);

        expect(callback).not.toHaveBeenCalled();
        vi.advanceTimersByTime(20);
        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(2);
    });

    it('flushes the final brush selection immediately', () => {
        vi.useFakeTimers();
        const callback = vi.fn();
        const updates = new SettledBrushUpdates<number>();

        updates.schedule(1, callback);
        updates.flush(2, callback);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(2);
        vi.runAllTimers();
        expect(callback).toHaveBeenCalledOnce();
    });

    it('drops pending work when cancelled', () => {
        vi.useFakeTimers();
        const callback = vi.fn();
        const updates = new SettledBrushUpdates<number>();

        updates.schedule(1, callback);
        updates.cancel();
        vi.runAllTimers();

        expect(callback).not.toHaveBeenCalled();
    });
});
