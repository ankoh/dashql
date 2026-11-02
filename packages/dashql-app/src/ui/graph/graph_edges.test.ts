import { describe, expect, it } from 'vitest';

import {
    buildEdgePathBetweenRectangles,
    EdgeType,
    NodePort,
    PathBuilder,
    PathType,
    PORTS_FROM,
    PORTS_TO,
    selectEdgeType,
    selectHorizontalEdgeType,
    selectVerticalEdgeType,
} from './graph_edges.js';

const WIDTH = 20;
const HEIGHT = 10;

/// The port of a rectangle around a center, North is the larger y
function portPosition(port: number, x: number, y: number): [number, number] {
    switch (port) {
        case NodePort.North: return [x, y + HEIGHT / 2];
        case NodePort.South: return [x, y - HEIGHT / 2];
        case NodePort.East: return [x + WIDTH / 2, y];
        default: return [x - WIDTH / 2, y];
    }
}

/// The first and the last point of a rendered path
function endpoints(path: string): [number, number][] {
    const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(n => Number(n) + 0); // no -0
    return [numbers.slice(0, 2) as [number, number], numbers.slice(-2) as [number, number]];
}

describe('selectEdgeType', () => {
    it.each([
        [100, 0, EdgeType.East],
        [0, 100, EdgeType.North],
        [-100, 0, EdgeType.West],
        [0, -100, EdgeType.South],
        [100, 80, EdgeType.EastNorth],
        [80, 100, EdgeType.NorthEast],
        [-100, -80, EdgeType.WestSouth],
        [100, 5, EdgeType.EastNorthEast],
        [5, 100, EdgeType.NorthEastNorth],
    ])('selects the edge type towards (%d, %d)', (dx, dy, type) => {
        expect(selectEdgeType(0, 0, dx, dy, WIDTH, HEIGHT)).toEqual(type);
    });

    it('selects the edge types of horizontal and vertical layouts', () => {
        expect(selectHorizontalEdgeType(0, 0, 100, 0)).toEqual(EdgeType.East);
        expect(selectHorizontalEdgeType(0, 0, 100, 80)).toEqual(EdgeType.EastNorthEast);
        expect(selectVerticalEdgeType(0, 0, 0, -100)).toEqual(EdgeType.South);
        expect(selectVerticalEdgeType(0, 0, 100, 80)).toEqual(EdgeType.NorthEastNorth);
    });
});

describe('buildEdgePathBetweenRectangles', () => {
    const types = Object.values(EdgeType).filter((type): type is EdgeType => typeof type === 'number');

    it.each(types)('connects the ports of edge type %d', type => {
        const path = buildEdgePathBetweenRectangles(new PathBuilder(), type, 0, 0, 100, 80, WIDTH, HEIGHT, WIDTH, HEIGHT, 4);
        const expectedType = type < 4 ? PathType.DIRECT : type < 12 ? PathType.SINGLE_TURN : PathType.TWO_TURNS;
        expect(path.pathType).toEqual(expectedType);
        expect(endpoints(path.render())).toEqual([portPosition(PORTS_FROM[type], 0, 0), portPosition(PORTS_TO[type], 100, 80)]);
    });

    it('continues a path when not standalone', () => {
        const path = buildEdgePathBetweenRectangles(new PathBuilder(), EdgeType.East, 0, 0, 100, 0, WIDTH, HEIGHT, WIDTH, HEIGHT, 4);
        expect(path.render()).toEqual('M 10 0 L 90 0');
        expect(path.render(false)).toEqual('L 10 0 L 90 0');
    });

    it('shifts direct edges by the offset', () => {
        const path = buildEdgePathBetweenRectangles(new PathBuilder(), EdgeType.East, 0, 0, 100, 0, WIDTH, HEIGHT, WIDTH, HEIGHT, 4, 3);
        expect(path.render()).toEqual('M 10 -3 L 90 -3');
    });

    it('renders nothing between rectangles at the same position', () => {
        const path = buildEdgePathBetweenRectangles(new PathBuilder(), EdgeType.East, 5, 5, 5, 5, WIDTH, HEIGHT, WIDTH, HEIGHT, 4);
        expect(path.render()).toEqual('');
    });
});
