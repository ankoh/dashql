import { buildFragmentPath, hasOutputCardinalityProduced, scaleRowWidths, selectDefaultRowMetric, truncatePlanLabel } from './plan_scene.js';

function pathContainsPoint(path: string, x: number, y: number): boolean {
    const contours = path.split('M ').filter(Boolean).map(contour => {
        const values = contour.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        const points: [number, number][] = [];
        for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
        return points;
    });
    let inside = false;
    for (const points of contours) {
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const [xi, yi] = points[i];
            const [xj, yj] = points[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
    }
    return inside;
}

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

describe('buildFragmentPath', () => {
    const operators = [
        { rect: { x: 50, y: 40, width: 40, height: 20 } },
        { rect: { x: 100, y: 100, width: 60, height: 30 } },
        { rect: { x: 180, y: 60, width: 20, height: 20 } },
    ];

    it('draws a padded contour around one operator', () => {
        const path = buildFragmentPath([2], operators, [], 8);
        expect(path).toContain('Q');
        expect(pathContainsPoint(path, 180, 60)).toEqual(true);
        expect(pathContainsPoint(path, 160, 60)).toEqual(false);
    });

    it('connects fragment operators without filling their bounding box', () => {
        const path = buildFragmentPath(
            [0, 1],
            operators,
            [{ childOperator: 0, parentOperator: 1 }],
            10,
            10,
        );
        expect(pathContainsPoint(path, 50, 40)).toEqual(true);
        expect(pathContainsPoint(path, 100, 100)).toEqual(true);
        expect(pathContainsPoint(path, 75, 70)).toEqual(true);
        expect(pathContainsPoint(path, 130, 40)).toEqual(false);
    });

    it('uses the fragment padding around connecting edges', () => {
        const path = buildFragmentPath(
            [0, 1],
            operators,
            [{ childOperator: 0, parentOperator: 1 }],
            10,
        );
        expect(pathContainsPoint(path, 55, 76)).toEqual(true);
        expect(pathContainsPoint(path, 55, 80)).toEqual(false);
    });

    it('does not include an adjacent non-member in the contour', () => {
        const fragmentOperators = [
            { rect: { x: 100, y: 40, width: 60, height: 20 } },
            { rect: { x: 100, y: 100, width: 40, height: 20 } },
            { rect: { x: 40, y: 160, width: 40, height: 20 } },
            { rect: { x: 160, y: 160, width: 40, height: 20 } },
            { rect: { x: 35, y: 100, width: 40, height: 20 } },
        ];
        const path = buildFragmentPath(
            [0, 1, 2, 3],
            fragmentOperators,
            [
                { childOperator: 1, parentOperator: 0 },
                { childOperator: 2, parentOperator: 1 },
                { childOperator: 3, parentOperator: 1 },
            ],
            10,
            10,
        );
        expect(pathContainsPoint(path, 40, 160)).toEqual(true);
        expect(pathContainsPoint(path, 160, 160)).toEqual(true);
        expect(pathContainsPoint(path, 35, 100)).toEqual(false);
    });

    it('returns an empty path for empty membership', () => {
        expect(buildFragmentPath([], operators)).toEqual('');
    });

    it('keeps diagonally touching operators as separate contours', () => {
        const path = buildFragmentPath([
            0,
            1,
        ], [
            { rect: { x: 10, y: 10, width: 20, height: 20 } },
            { rect: { x: 30, y: 30, width: 20, height: 20 } },
        ], [], 0);
        expect(path.match(/M /g)).toHaveLength(2);
        expect(pathContainsPoint(path, 10, 10)).toEqual(true);
        expect(pathContainsPoint(path, 30, 30)).toEqual(true);
    });
});
