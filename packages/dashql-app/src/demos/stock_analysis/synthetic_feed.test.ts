import { describe, expect, it } from 'vitest';

import { seededRandom, SyntheticFeed, SYNTHETIC_SYMBOLS } from './synthetic_feed.js';

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
