import { afterEach, describe, expect, it, vi } from 'vitest';
import * as d3 from 'd3';

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

describe('d3 brush geometry', () => {
    it('keeps hidden brush rectangles valid for WebKit', () => {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const brush = d3.brushX().extent([[0, 0], [100, 20]]);

        d3.select(group).call(brush).call(brush.move, null);

        for (const rect of group.querySelectorAll<SVGRectElement>('.selection, .handle')) {
            expect(rect.getAttribute('x')).toBe('0');
            expect(rect.getAttribute('y')).toBe('0');
            expect(rect.getAttribute('width')).toBe('0');
            expect(rect.getAttribute('height')).toBe('0');
        }
    });
});
