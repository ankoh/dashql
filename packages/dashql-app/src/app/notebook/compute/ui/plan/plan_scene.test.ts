import { resolveOutputRows, scaleOutputRowWidths, truncatePlanLabel } from './plan_scene.js';

describe('truncatePlanLabel', () => {
    it('preserves labels that fit', () => {
        expect(truncatePlanLabel('orders', 6)).toEqual('orders');
    });

    it('uses the same character budget for the ellipsis', () => {
        expect(truncatePlanLabel('customer_orders', 8)).toEqual('custome…');
    });

    it('counts unicode code points instead of UTF-16 units', () => {
        expect(truncatePlanLabel('a😀bc', 3)).toEqual('a😀…');
    });

    it('renders no text when the budget is zero', () => {
        expect(truncatePlanLabel('orders', 0)).toEqual('');
    });
});

describe('resolveOutputRows', () => {
    it('uses estimated rows for plans without runtime statistics', () => {
        expect(resolveOutputRows({ cardinality: 1200 }, 0)).toEqual(1200);
        expect(resolveOutputRows({ estimatedRows: 800 }, 0)).toEqual(800);
        expect(resolveOutputRows({ 'estimated-rows': 400 }, 0)).toEqual(400);
    });

    it('prefers analyzed output rows over estimates', () => {
        expect(resolveOutputRows({
            cardinality: 1200,
            statistics: { 'output-rows': 42 },
        }, 1200)).toEqual(42);
        expect(resolveOutputRows({
            estimatedRows: 800,
            statistics: { outputRows: 21 },
        }, 800)).toEqual(21);
    });

    it('preserves an analyzed output of zero', () => {
        expect(resolveOutputRows({
            cardinality: 1200,
            statistics: { 'output-rows': 0 },
        }, 1200)).toEqual(0);
    });

    it('supports runtime statistics stored directly on the operator', () => {
        expect(resolveOutputRows({ outputRows: 18, estimatedRows: 800 }, 800)).toEqual(18);
    });

    it('falls back to parsed estimates when raw properties omit cardinality', () => {
        expect(resolveOutputRows({}, 64)).toEqual(64);
    });
});

describe('scaleOutputRowWidths', () => {
    it('maps zero to the minimum and the largest flow to the maximum', () => {
        expect(scaleOutputRowWidths([0, 10, 100])).toEqual([1, expect.any(Number), 8]);
        expect(scaleOutputRowWidths([0, 10, 100])[1]).toBeGreaterThan(1);
        expect(scaleOutputRowWidths([0, 10, 100])[1]).toBeLessThan(8);
    });

    it('uses a logarithmic scale for skewed cardinalities', () => {
        const [small, medium, large] = scaleOutputRowWidths([1, 1000, 1000000]);
        expect(small).toBeGreaterThanOrEqual(1);
        expect(medium).toBeGreaterThan(small);
        expect(large).toEqual(8);
        expect(medium).toBeGreaterThan(4);
    });

    it('uses the minimum width when no rows flow', () => {
        expect(scaleOutputRowWidths([0, 0, Number.NaN])).toEqual([1, 1, 1]);
    });
});
