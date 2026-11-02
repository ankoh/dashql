import * as dashql from './index.js';

import { loadDataflowWasm } from './test_fixture.js';

let layout: dashql.DashQLDataflow | null = null;
beforeAll(async () => {
    layout = await dashql.DashQLDataflow.create({ wasmBinary: await loadDataflowWasm() });
});

describe('DashQL dataflow layout', () => {
    it('lays out boxes from left to right and routes the edges between them', () => {
        const { boxes, routes } = layout!.computeDataflowLayoutWithRoutes(
            [{ statements: 2 }, { statements: 1 }],
            [{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0 }],
        );
        expect(boxes[0]).toEqual({ x: 0, y: 0, width: 280, height: 112, rows: [40, 72] });
        // Right of the producer, the row it reads is level with the row it reads from
        expect([boxes[1].x, boxes[1].y + boxes[1].rows[0]]).toEqual([376, 72]);
        expect(routes).toEqual([{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0, points: [[280, 88], [376, 88]] }]);
    });

    it('lays out from the hints of the boxes', () => {
        const boxes = layout!.computeDataflowLayout(
            [{ statements: 2, hint: { x: 100, y: 40 } }, { statements: 1, hint: { x: 480, y: 400 }, dropped: true }],
            [{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0 }],
        );
        // The box that stays places the layout, the dropped one keeps its y in the column right of it
        expect([boxes[0].x, boxes[0].y]).toEqual([100, 40]);
        expect([boxes[1].x, boxes[1].y]).toEqual([476, 400]);
    });

    it('routes edges around the boxes in the way', () => {
        const box = (x: number) => ({ x, y: 0, width: 100, height: 60 });
        const [route] = layout!.routeDataflowEdges([box(0), box(200), box(400)], [{ from: [100, 30], to: [400, 30] }]);
        expect(route?.[0]).toEqual([100, 30]);
        expect(route?.[route.length - 1]).toEqual([400, 30]);
        expect(route!.length).toBeGreaterThan(2);
    });
});
