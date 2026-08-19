import { buildFragmentRect, hasOutputCardinalityProduced, scaleRowWidths, selectDefaultRowMetric, truncatePlanLabel } from './plan_scene.js';

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

describe('hasOutputCardinalityProduced', () => {
    it('detects analyzed output rows without conflating them with estimates', () => {
        expect(hasOutputCardinalityProduced({ cardinality: 1200 })).toEqual(false);
        expect(hasOutputCardinalityProduced({ statistics: { 'output-rows': 42 } })).toEqual(true);
        expect(hasOutputCardinalityProduced({ statistics: { outputRows: 21 } })).toEqual(true);
        expect(hasOutputCardinalityProduced({ outputRows: 18 })).toEqual(true);
    });

    it('detects an analyzed output of zero', () => {
        expect(hasOutputCardinalityProduced({ statistics: { 'output-rows': 0 } })).toEqual(true);
    });
});

describe('selectDefaultRowMetric', () => {
    it('selects estimates for non-analyzed plans', () => {
        expect(selectDefaultRowMetric([
            { outputCardinalityProduced: null },
            { outputCardinalityProduced: null },
        ])).toEqual('estimatedRows');
    });

    it('selects actual output rows when the plan contains them', () => {
        expect(selectDefaultRowMetric([
            { outputCardinalityProduced: null },
            { outputCardinalityProduced: 0 },
        ])).toEqual('outputRows');
    });
});

describe('scaleRowWidths', () => {
    it('maps zero to the minimum and the largest flow to the maximum', () => {
        expect(scaleRowWidths([0, 10, 100])).toEqual([1, expect.any(Number), 8]);
        expect(scaleRowWidths([0, 10, 100])[1]).toBeGreaterThan(1);
        expect(scaleRowWidths([0, 10, 100])[1]).toBeLessThan(8);
    });

    it('uses a logarithmic scale for skewed cardinalities', () => {
        const [small, medium, large] = scaleRowWidths([1, 1000, 1000000]);
        expect(small).toBeGreaterThanOrEqual(1);
        expect(medium).toBeGreaterThan(small);
        expect(large).toEqual(8);
        expect(medium).toBeGreaterThan(4);
    });

    it('uses the minimum width for missing or zero rows', () => {
        expect(scaleRowWidths([0, null, Number.NaN])).toEqual([1, 1, 1]);
    });
});

describe('buildFragmentRect', () => {
    const operators = [
        { rect: { x: 50, y: 40, width: 40, height: 20 } },
        { rect: { x: 100, y: 100, width: 60, height: 30 } },
        { rect: { x: 180, y: 60, width: 20, height: 20 } },
    ];

    it('bounds all fragment operators with padding', () => {
        expect(buildFragmentRect([0, 1], operators, 10)).toEqual({
            x: 20,
            y: 20,
            width: 120,
            height: 105,
        });
    });

    it('ignores operators outside the fragment', () => {
        expect(buildFragmentRect([2], operators, 8)).toEqual({
            x: 162,
            y: 42,
            width: 36,
            height: 36,
        });
    });

    it('returns an empty rectangle for empty membership', () => {
        expect(buildFragmentRect([], operators)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
});
