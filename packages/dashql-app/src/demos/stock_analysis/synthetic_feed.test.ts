import { afterEach, describe, expect, it, vi } from 'vitest';

import { seededRandom, SyntheticFeed, SYNTHETIC_SYMBOLS } from './synthetic_feed.js';
import type { Tick, TickFeedStatus } from './tick_feed.js';

describe('SyntheticFeed', () => {
    it('generates the same ticks for the same seed', () => {
        const a = new SyntheticFeed({ seed: 7 }).generate(100, 1_000_000);
        const b = new SyntheticFeed({ seed: 7 }).generate(100, 1_000_000);
        const c = new SyntheticFeed({ seed: 8 }).generate(100, 1_000_000);
        expect(a).toEqual(b);
        expect(a).not.toEqual(c);
    });

    it('generates plausible trades', () => {
        const feed = new SyntheticFeed({ seed: 1 });
        const symbols = new Set(SYNTHETIC_SYMBOLS.map(s => s.symbol));
        let last = -Infinity;
        for (let i = 1; i <= 20; ++i) {
            for (const tick of feed.generate(500, i * 1000)) {
                expect(symbols.has(tick.symbol)).toBe(true);
                expect(tick.ts).toBeGreaterThanOrEqual(last);
                expect(tick.price).toBeGreaterThan(0);
                expect(tick.size).toBeGreaterThanOrEqual(1);
                expect(tick.bid!).toBeLessThan(tick.ask!);
                last = tick.ts;
            }
        }
    });

    it('spreads the ticks over the time since the previous delivery', () => {
        const feed = new SyntheticFeed({ seed: 1 });
        feed.generate(1, 1000);
        const ticks = feed.generate(4, 2000);
        expect(ticks.map(t => t.ts)).toEqual([1250, 1500, 1750, 2000]);
    });

    it('draws numbers in [0, 1)', () => {
        const random = seededRandom(3);
        for (let i = 0; i < 1000; ++i) {
            const value = random();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
        }
    });
});

describe('SyntheticFeed delivery', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('backfills the history at a tenth of the rate and then emits live ticks', () => {
        vi.useFakeTimers();
        const feed = new SyntheticFeed({ seed: 1, ticksPerSecond: 100, emitIntervalMs: 50, backfillMs: 10_000 });
        const deliveries: Tick[][] = [];
        const statuses: TickFeedStatus[] = [];
        const startedAt = Date.now();
        feed.start(ticks => deliveries.push(ticks), status => statuses.push(status));
        expect(statuses).toEqual([{ state: 'live' }]);
        expect(deliveries.length).toBe(1);
        expect(deliveries[0].length).toBe(100);
        expect(deliveries[0][0].ts).toBeGreaterThan(startedAt - 10_000);
        expect(deliveries[0][deliveries[0].length - 1]!.ts).toBe(startedAt);

        // 100 ticks per second are 5 ticks every 50 ms
        vi.advanceTimersByTime(50);
        expect(deliveries.length).toBe(2);
        expect(deliveries[1].length).toBe(5);
        expect(deliveries[1][deliveries[1].length - 1]!.ts).toBe(startedAt + 50);
        vi.advanceTimersByTime(950);
        expect(deliveries.slice(1).reduce((n, ticks) => n + ticks.length, 0)).toBe(100);

        feed.stop();
        vi.advanceTimersByTime(1000);
        expect(deliveries.length).toBe(21);
    });

    it('carries fractional ticks over to later intervals', () => {
        vi.useFakeTimers();
        const feed = new SyntheticFeed({ seed: 1, ticksPerSecond: 10, emitIntervalMs: 50, backfillMs: 0 });
        const deliveries: Tick[][] = [];
        feed.start(ticks => deliveries.push(ticks), () => { });
        // Half a tick per interval, every second interval emits one
        vi.advanceTimersByTime(50);
        expect(deliveries).toEqual([]);
        vi.advanceTimersByTime(50);
        expect(deliveries.map(ticks => ticks.length)).toEqual([1]);
        vi.advanceTimersByTime(900);
        expect(deliveries.map(ticks => ticks.length)).toEqual(Array(10).fill(1));
        feed.stop();
    });

    it('does not backfill again when restarted', () => {
        vi.useFakeTimers();
        const feed = new SyntheticFeed({ seed: 1, ticksPerSecond: 100, backfillMs: 1000 });
        const deliveries: Tick[][] = [];
        feed.start(ticks => deliveries.push(ticks), () => { });
        expect(deliveries.length).toBe(1);
        feed.start(ticks => deliveries.push(ticks), () => { });
        expect(deliveries.length).toBe(1);
        feed.stop();
        feed.stop();
    });
});
