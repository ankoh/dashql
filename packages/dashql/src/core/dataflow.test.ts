import * as dashql from './index.js';

import { loadDataflowWasm } from './test_fixture.js';

let layout: dashql.DashQLDataflow | null = null;
beforeAll(async () => {
    layout = await dashql.DashQLDataflow.create({ wasmBinary: await loadDataflowWasm() });
});

describe('DashQL dataflow layout', () => {
    it('tells the sizes of the canvas', () => {
        const { boxWidth, inputBoxWidth, headerHeight, rowHeight, rowPadding, grid } = layout!.config;
        for (const size of [boxWidth, inputBoxWidth, headerHeight, rowHeight, rowPadding, grid]) {
            expect(size).toBeGreaterThan(0);
        }
        expect(Object.isFrozen(layout!.config)).toBe(true);
    });

    it('lays out boxes from left to right and routes the edges between them', () => {
        const { boxes, routes } = layout!.computeDataflowLayoutWithRoutes(
            [{ statements: 2 }, { statements: 1 }],
            [{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0 }],
        );
        const { boxWidth, rowHeight, layerGap } = layout!.config;
        expect(boxes[0]).toMatchObject({ x: 0, y: 0, width: boxWidth });
        // A row per statement, from top to bottom, inside the box
        expect(boxes[0].rows).toHaveLength(2);
        expect(boxes[0].rows[1]).toBeGreaterThan(boxes[0].rows[0]);
        expect(boxes[0].height).toBeGreaterThan(boxes[0].rows[1] + rowHeight);
        // Right of the producer, the row it reads is level with the row it reads from
        const producerRow = boxes[0].y + boxes[0].rows[1];
        expect([boxes[1].x, boxes[1].y + boxes[1].rows[0]]).toEqual([boxWidth + layerGap, producerRow]);
        // The edge runs straight between the middles of the two rows
        const portY = producerRow + rowHeight / 2;
        expect(routes).toEqual([{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0, points: [[boxWidth, portY], [boxWidth + layerGap, portY]] }]);
    });

    it('lays out from the hints of the boxes', () => {
        const boxes = layout!.computeDataflowLayout(
            [{ statements: 2, hint: { x: 100, y: 40 } }, { statements: 1, hint: { x: 480, y: 400 }, dropped: true }],
            [{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0 }],
        );
        // The box that stays places the layout, the dropped one keeps its y in the column right of it
        expect([boxes[0].x, boxes[0].y]).toEqual([100, 40]);
        expect([boxes[1].x, boxes[1].y]).toEqual([100 + layout!.config.boxWidth + layout!.config.layerGap, 400]);
    });

    it('routes edges around the boxes in the way', () => {
        const box = (x: number) => ({ x, y: 0, width: 100, height: 60 });
        const [route] = layout!.routeDataflowEdges([box(0), box(200), box(400)], [{ from: [100, 30], to: [400, 30] }]);
        expect(route?.[0]).toEqual([100, 30]);
        expect(route?.[route.length - 1]).toEqual([400, 30]);
        expect(route!.length).toBeGreaterThan(2);
    });
});
