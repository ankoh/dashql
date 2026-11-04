import { buildCrossEdgePath, buildFragmentPath, buildPipelinePath, estimateRelativeDifference, truncateProfileLabel } from './profile_scene.js';

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

describe('truncateProfileLabel', () => {
    it('preserves labels that fit', () => {
        expect(truncateProfileLabel('orders', 6)).toEqual('orders');
    });

    it('uses the same character budget for the ellipsis', () => {
        expect(truncateProfileLabel('customer_orders', 8)).toEqual('custome…');
    });

    it('counts unicode code points instead of UTF-16 units', () => {
        expect(truncateProfileLabel('a😀bc', 3)).toEqual('a😀…');
    });

    it('renders no text when the budget is zero', () => {
        expect(truncateProfileLabel('orders', 0)).toEqual('');
    });
});

describe('estimateRelativeDifference', () => {
    it('is neutral when estimated and actual rows match', () => {
        expect(estimateRelativeDifference(100, 100)).toEqual(0);
        expect(estimateRelativeDifference(0, 0)).toEqual(0);
    });

    it('expresses the error relative to the estimate', () => {
        expect(estimateRelativeDifference(1, 2)).toEqual(1);
        expect(estimateRelativeDifference(2, 1)).toEqual(-0.5);
        expect(estimateRelativeDifference(10, 100)).toEqual(9);
    });

    it('uses infinity when actual rows exceed a zero estimate', () => {
        expect(estimateRelativeDifference(100, 0)).toEqual(-1);
        expect(estimateRelativeDifference(0, 100)).toEqual(Number.POSITIVE_INFINITY);
    });
});

describe('buildCrossEdgePath', () => {
    it('connects the centered tree ports with external control points', () => {
        expect(buildCrossEdgePath(
            { x: 40, y: 160, width: 60, height: 32 },
            { x: 200, y: 160, width: 80, height: 32 },
        )).toEqual('M 40 144 C 40 120, 200 224, 200 176');
    });

    it('connects the side ports of a left-to-right plan', () => {
        // From the left side of the source to the right side of the target
        expect(buildCrossEdgePath(
            { x: 400, y: 60, width: 60, height: 32 },
            { x: 100, y: 16, width: 80, height: 32 },
            24,
            48,
            true,
        )).toEqual('M 370 60 C 255 60, 255 16, 140 16');
    });

    it('keeps vertical tension when the lead endpoints align', () => {
        expect(buildCrossEdgePath(
            { x: 40, y: 224, width: 60, height: 32 },
            { x: 200, y: 160, width: 80, height: 32 },
        )).toEqual('M 40 208 C 40 184, 200 224, 200 176');
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

    it('routes the connecting edges of a left-to-right plan through the gap between the columns', () => {
        // The parent at the left, its input right of it and lower
        const path = buildFragmentPath(
            [0, 1],
            [
                { rect: { x: 40, y: 16, width: 40, height: 20 } },
                { rect: { x: 160, y: 60, width: 40, height: 20 } },
            ],
            [{ childOperator: 1, parentOperator: 0 }],
            10,
            10,
            true,
        );
        // Left from the child, up in the middle of the gap, left into the parent
        expect(pathContainsPoint(path, 120, 60)).toEqual(true);
        expect(pathContainsPoint(path, 100, 40)).toEqual(true);
        expect(pathContainsPoint(path, 80, 16)).toEqual(true);
        expect(pathContainsPoint(path, 60, 60)).toEqual(false);
        expect(pathContainsPoint(path, 140, 16)).toEqual(false);
    });

    it('fills the gap between an operator and the parent directly above it', () => {
        const path = buildFragmentPath(
            [0, 1],
            [
                { rect: { x: 100, y: 40, width: 60, height: 20 } },
                { rect: { x: 100, y: 100, width: 40, height: 20 } },
            ],
            [{ childOperator: 1, parentOperator: 0 }],
            10,
        );
        // The gap is as wide as the padded child, not only the corridor along the edge
        expect(pathContainsPoint(path, 72, 70)).toEqual(true);
        expect(pathContainsPoint(path, 128, 70)).toEqual(true);
        expect(pathContainsPoint(path, 65, 70)).toEqual(false);
        expect(path.split('M ').filter(Boolean).length).toEqual(1);
    });

    it('fills the gap between an operator and the parent directly left of it in a left-to-right plan', () => {
        const path = buildFragmentPath(
            [0, 1],
            [
                { rect: { x: 40, y: 40, width: 40, height: 30 } },
                { rect: { x: 120, y: 40, width: 40, height: 20 } },
            ],
            [{ childOperator: 1, parentOperator: 0 }],
            10,
            10,
            true,
        );
        expect(pathContainsPoint(path, 80, 22)).toEqual(true);
        expect(pathContainsPoint(path, 80, 58)).toEqual(true);
        expect(pathContainsPoint(path, 80, 15)).toEqual(false);
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

describe('buildPipelinePath', () => {
    const operators = [
        { rect: { x: 50, y: 40, width: 40, height: 20 } },
        { rect: { x: 150, y: 40, width: 40, height: 20 } },
    ];

    it('draws one rounded rectangle with a padding of 4 per operator of the pipeline', () => {
        // The first operator spans 30..70 x 30..50, padded 26..74 x 26..54 with a corner radius of 8
        const first = 'M 34 26 H 66 Q 74 26 74 34 V 46 Q 74 54 66 54 H 34 Q 26 54 26 46 V 34 Q 26 26 34 26 Z';
        expect(buildPipelinePath([0], operators)).toBe(first);
        // Operators that are not in the scene are skipped
        const both = buildPipelinePath([0, 7, 1], operators);
        expect(both.startsWith(`${first} M 134 26`)).toBe(true);
        expect(both.match(/M /g)).toHaveLength(2);
    });

    it('draws nothing for an empty pipeline', () => {
        expect(buildPipelinePath([], operators)).toBe('');
    });
});

