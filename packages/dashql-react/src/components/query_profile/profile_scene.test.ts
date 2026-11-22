import { buildCrossEdgePath, buildFragmentPath, buildPipelinePath, estimateRelativeDifference, truncateProfileLabel } from './profile_scene.js';
import { describe, expect, it } from 'vitest';

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

/// The points of a cubic edge 'M x y C x1 y1, x2 y2, x y': the start, the two control points and the end
function cubicPoints(path: string): [number, number][] {
    const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(values).toHaveLength(8);
    return [[values[0], values[1]], [values[2], values[3]], [values[4], values[5]], [values[6], values[7]]];
}

/// Whether the browser fills a point of a path
function fillsPoint(path: string, x: number, y: number): boolean {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    element.setAttribute('d', path);
    svg.appendChild(element);
    document.body.appendChild(svg);
    try {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        return element.isPointInFill(point);
    } finally {
        svg.remove();
    }
}

describe('buildCrossEdgePath', () => {
    it('connects the centered tree ports with external control points', () => {
        const [start, lead, tail, end] = cubicPoints(buildCrossEdgePath(
            { x: 40, y: 160, width: 60, height: 32 },
            { x: 200, y: 160, width: 80, height: 32 },
        ));
        // From the top of the source to the bottom of the target, the control points lie outside of both
        expect(start).toEqual([40, 160 - 32 / 2]);
        expect(end).toEqual([200, 160 + 32 / 2]);
        expect(lead[1]).toBeLessThan(start[1]);
        expect(tail[1]).toBeGreaterThan(end[1]);
    });

    it('connects the side ports of a left-to-right plan', () => {
        // From the left side of the source to the right side of the target
        const [start, lead, tail, end] = cubicPoints(buildCrossEdgePath(
            { x: 400, y: 60, width: 60, height: 32 },
            { x: 100, y: 16, width: 80, height: 32 },
            24,
            48,
            true,
        ));
        expect(start).toEqual([400 - 60 / 2, 60]);
        expect(end).toEqual([100 + 80 / 2, 16]);
        // The edge leaves and enters horizontally
        expect(lead[1]).toEqual(start[1]);
        expect(tail[1]).toEqual(end[1]);
    });

    it('keeps vertical tension when the lead endpoints align', () => {
        const [start, lead, tail, end] = cubicPoints(buildCrossEdgePath(
            { x: 40, y: 224, width: 60, height: 32 },
            { x: 200, y: 160, width: 80, height: 32 },
        ));
        expect(lead[1]).toBeLessThan(start[1]);
        expect(tail[1]).toBeGreaterThan(end[1]);
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

    it('draws one padded rounded rectangle per operator of the pipeline', () => {
        // The first operator spans 30..70 x 30..50, the padding grows it on every side
        const first = buildPipelinePath([0], operators);
        expect(fillsPoint(first, 50, 40)).toEqual(true);
        expect(fillsPoint(first, 72, 40)).toEqual(true);
        expect(fillsPoint(first, 50, 52)).toEqual(true);
        expect(fillsPoint(first, 80, 40)).toEqual(false);
        expect(fillsPoint(first, 50, 60)).toEqual(false);
        // Operators that are not in the scene are skipped
        const both = buildPipelinePath([0, 7, 1], operators);
        expect(both.match(/M /g)).toHaveLength(2);
        expect(fillsPoint(both, 50, 40)).toEqual(true);
        expect(fillsPoint(both, 150, 40)).toEqual(true);
        expect(fillsPoint(both, 110, 40)).toEqual(false);
    });

    it('draws nothing for an empty pipeline', () => {
        expect(buildPipelinePath([], operators)).toBe('');
    });
});

