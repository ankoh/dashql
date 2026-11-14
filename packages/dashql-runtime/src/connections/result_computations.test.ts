import { describe, expect, it } from 'vitest';

import { ResultComputations } from './result_computations.js';

describe('ResultComputations', () => {
    it('replaces the previous result of an owner and drops a stale one', () => {
        const computations = new ResultComputations();
        expect(computations.retain('script', 1)).toBeNull();
        expect(computations.retain('other', 2)).toBeNull();
        expect(computations.retain('script', 4)).toBe(1);
        // An overlapping run that started earlier finishes later
        expect(computations.retain('script', 3)).toBe(3);
        expect(computations.retain('script', 5)).toBe(4);
    });
});
