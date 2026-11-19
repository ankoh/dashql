import { describe, expect, it } from 'vitest';

import { ByteFormat, formatBytes, formatHHMMSS, formatMilliseconds, formatNanoseconds, formatThousands, formatTimeDifference, quoteIfAnyUpper } from './format.js';

describe('formatting', () => {
    it('formats bytes in SI and IEC units', () => {
        expect(formatBytes(1)).toBe('1 byte');
        expect(formatBytes(512)).toBe('512 bytes');
        expect(formatBytes(1500)).toBe('1.5 kB');
        expect(formatBytes(2048, ByteFormat.IEC)).toBe('2 KiB');
        expect(formatBytes(3 * 1000 * 1000)).toBe('3 MB');
    });

    it('formats thousands', () => {
        expect(formatThousands(999)).toBe('999');
        expect(formatThousands(12_500)).toBe('12.5 k');
        expect(formatThousands(2_000_000)).toBe('2 M');
    });

    it.each([
        [12.34, '12.3 ns'],
        [4_500, '5 us'],
        [2_500_000, '2.50 ms'],
        [2_000_000_000, '2.0 s'],
    ])('formats %d nanoseconds as %s', (value, text) => {
        expect(formatNanoseconds(value)).toBe(text);
    });

    it('formats milliseconds', () => {
        expect(formatMilliseconds(250)).toBe('250 ms');
        expect(formatMilliseconds(1_500)).toBe('1.50 s');
    });

    it('formats durations as HH:MM:SS', () => {
        expect(formatHHMMSS(5)).toBe('00:00:05');
        expect(formatHHMMSS(3_725)).toBe('01:02:05');
        expect(formatHHMMSS(40_000)).toBe('11:06:40');
    });

    it('formats time differences in the largest unit', () => {
        const from = new Date(Date.UTC(2026, 0, 10));
        expect(formatTimeDifference(new Date(from.getTime() + 3 * 60 * 60 * 1000), from)).toBe('in 3 hours');
        expect(formatTimeDifference(new Date(from.getTime() - 2 * 24 * 60 * 60 * 1000), from)).toBe('2 days ago');
        expect(formatTimeDifference(new Date(from.getTime() - 500), from)).toBe('now');
    });

    it('quotes names with upper-case letters', () => {
        expect(quoteIfAnyUpper('orders')).toBe('orders');
        expect(quoteIfAnyUpper('Orders')).toBe('"Orders"');
    });
});
