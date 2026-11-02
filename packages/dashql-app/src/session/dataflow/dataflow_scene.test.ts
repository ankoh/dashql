import * as core from '@ankoh/dashql-core';
import { describe, expect, it } from 'vitest';

import { DataflowEdgeKind, type DataflowGraph, type DataflowScript } from './dataflow_graph.js';
import {
    buildDataflowScene,
    DATAFLOW_LAYOUT,
    dataflowChartHeight,
    dataflowLayoutInput,
    fitDataflowScene,
    INPUT_BOX_WIDTH,
    resizeDataflowBox,
    selectedEdges,
} from './dataflow_scene.js';

const SELECT = core.buffers.parser.StatementType.SELECT;

function script(scriptKey: number, statements: number): DataflowScript {
    return {
        scriptKey,
        fileName: `${scriptKey}.sql`,
        connectionId: 'main',
        statements: Array.from({ length: statements }, (_, i) => ({ statementId: i, statementType: SELECT, target: null, from: 0, to: 1, label: `s${i}` })),
        current: true,
    };
}

const GRAPH: DataflowGraph = {
    scripts: [script(1, 2), script(2, 1)],
    inputs: [],
    edges: [
        { key: 'a', from: { scriptKey: 1, statementId: 0 }, to: { scriptKey: 1, statementId: 1 }, kind: DataflowEdgeKind.Table, name: 't', input: null },
        { key: 'b', from: { scriptKey: 1, statementId: 1 }, to: { scriptKey: 2, statementId: 0 }, kind: DataflowEdgeKind.Table, name: 't', input: null },
    ],
};

// Positions like the core lays them out: header 32, padding 8, rows of 32
const POSITIONS = [
    { x: 0, y: 0, width: 280, height: 120, rows: [40, 72] },
    { x: 376, y: 32, width: 280, height: 80, rows: [40] },
];

/// The first point of a path
function start(path: string): [number, number] {
    const [, x, y] = path.split(/\s+/);
    return [Number(x), Number(y)];
}

describe('dataflow scene', () => {
    it('passes the edges between boxes to the layout', () => {
        const input = dataflowLayoutInput(GRAPH, s => (s.scriptKey === 2 ? { x: 1, y: 2 } : null), () => null, () => false);
        expect(input.boxes.map(b => [b.statements, b.fixed])).toEqual([[2, null], [1, { x: 1, y: 2 }]]);
        expect(input.edges).toEqual([{ fromBox: 0, fromStatement: 1, toBox: 1, toStatement: 0 }]);
    });

    it('draws edges between statement rows, inside a box along its rows', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, () => null, () => false);
        const [internal, between] = scene.edges;
        expect(internal.internal).toBe(true);
        // From the left border of the rows of the box
        expect(start(internal.path)).toEqual([DATAFLOW_LAYOUT.rowPadding, 40 + 16]);
        expect(between.internal).toBe(false);
        // From the right border of the second row of the first box
        expect(start(between.path)).toEqual([280 - DATAFLOW_LAYOUT.rowPadding, 72 + 16]);
        expect(between.badge?.text).toBe('t');
        expect(scene.boxes[0].rows.map(r => [r.input, r.output])).toEqual([[true, false], [true, true]]);
        expect(scene.boxes[1].rows.map(r => [r.input, r.output])).toEqual([[true, false]]);
        expect(scene.bounds).toEqual({ x: 0, y: 0, width: 656, height: 120 });
    });

    it('routes an edge to a box on the left around the boxes, from the output port to the input port', () => {
        const backward = [POSITIONS[0], { x: 0, y: 200, width: 280, height: 80, rows: [40] }];
        const edge = buildDataflowScene(GRAPH, [{ ...POSITIONS[0], x: 376 }, backward[1]], () => null, () => false).edges[1];
        const points = edge.path.match(/-?\d+(\.\d+)? -?\d+(\.\d+)?/g)!.map(p => p.split(' ').map(Number));
        // Out of the right of the source row, into the left of the target row
        expect(points[0]).toEqual([376 + 280 - DATAFLOW_LAYOUT.rowPadding, 88]);
        expect(points[points.length - 1]).toEqual([DATAFLOW_LAYOUT.rowPadding, 200 + 40 + 16]);
        // Between the boxes, the badge on the way back
        expect(edge.badge?.y).toBe((120 + 200) / 2);
    });

    it('routes an edge between boxes stacked at the same x around them', () => {
        const stacked = [POSITIONS[0], { x: 0, y: 200, width: 280, height: 80, rows: [40] }];
        const edge = buildDataflowScene(GRAPH, stacked, () => null, () => false).edges[1];
        // A bend out of the source port, back through the gap between the boxes, a bend into the target port
        expect(edge.path).toBe('M 272 88 C 320 88, 320 160, 272 160 L 8 160 C -40 160, -40 256, 8 256');
    });

    it('merges the edges of collapsed boxes and leaves out the edges inside them', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, () => null, () => true);
        expect(scene.edges.map(e => e.key)).toEqual(['b']);
        expect(start(scene.edges[0].path)).toEqual([280, DATAFLOW_LAYOUT.headerHeight / 2]);
        expect(scene.boxes[0].output).toBe(true);
        expect(scene.boxes[1].input).toBe(true);
    });

    it('passes the size of a resized box to the layout', () => {
        const input = dataflowLayoutInput(GRAPH, () => null, () => 0, () => false, () => null, s => (s.scriptKey === 1 ? { width: 400, chartHeight: 96 } : null));
        expect(input.boxes.map(b => [b.width, b.chartHeight])).toEqual([[400, 96], [undefined, undefined]]);
    });

    it('takes the height of a chart from the layout and resizes it', () => {
        // Rows of 32 at 40 and below a chart of 96 at 40 + 32 + 8 + 96
        const p = { x: 0, y: 0, width: 280, height: 216 + 32 + 8, rows: [40, 176, 216] };
        expect(dataflowChartHeight(p, 0)).toBe(96);
        const resized = resizeDataflowBox(p, 0, 400, 200);
        expect(resized).toEqual({ x: 0, y: 0, width: 400, height: 256 + 104, rows: [40, 280, 320] });
        expect(dataflowChartHeight(resized, 0)).toBe(200);
        // A box without a chart only changes its width
        expect(resizeDataflowBox(p, null, 320, 200)).toEqual({ ...p, width: 320 });
        // A chart below the last row reaches down to the padding of the box
        const scene = buildDataflowScene(GRAPH, [{ ...POSITIONS[0], height: 72 + 32 + 8 + 104 + 8 }, POSITIONS[1]], s => (s.scriptKey === 1 ? 1 : null), () => false);
        expect(scene.boxes[0].chart?.height).toBe(104);
    });

    it('places the chart below the visualized statement', () => {
        // The layout makes room for the chart of the default height below the row
        const withChart = [POSITIONS[0], { ...POSITIONS[1], height: 40 + 32 + 8 + DATAFLOW_LAYOUT.chartHeight + 8 }];
        const scene = buildDataflowScene(GRAPH, withChart, s => (s.scriptKey === 2 ? 0 : null), () => false);
        expect(scene.boxes[1].chart).toEqual({ x: 384, y: 32 + 40 + 32 + 8, width: 264, height: DATAFLOW_LAYOUT.chartHeight });
        expect(scene.boxes[0].chart).toBeNull();
    });

    it('selects the edges of a statement or of a box', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, () => null, () => false);
        expect(selectedEdges(scene, { scriptKey: 1, statementId: 0 }).map(e => e.key)).toEqual(['a']);
        expect(selectedEdges(scene, { scriptKey: 1, statementId: null }).map(e => e.key)).toEqual(['a', 'b']);
        expect(selectedEdges(scene, null)).toEqual([]);
    });

    it('lays out an input as a box of one row and routes its edges from the row', () => {
        const type = { kind: core.buffers.analyzer.SqlTypeKind.INT4, sql: 'integer', arrayDimensions: 0, withTimeZone: false, cast: true, known: true };
        const graph: DataflowGraph = {
            ...GRAPH,
            inputs: [{ name: 'min', type, value: '10' }],
            edges: [
                ...GRAPH.edges,
                { key: 'i', from: { scriptKey: -1, statementId: 0 }, to: { scriptKey: 2, statementId: 0 }, kind: DataflowEdgeKind.Input, name: 'min', input: 'min' },
            ],
        };
        const input = dataflowLayoutInput(graph, () => null, () => null, () => false, () => ({ x: 8, y: 16 }));
        expect(input.boxes[2]).toEqual({ statements: 1, width: INPUT_BOX_WIDTH, fixed: { x: 8, y: 16 }, input: true });
        expect(input.edges).toContainEqual({ fromBox: 2, fromStatement: 0, toBox: 1, toStatement: 0 });
        const positions = [{ ...POSITIONS[0], x: 296 }, { ...POSITIONS[1], x: 672 }, { x: 0, y: 200, width: INPUT_BOX_WIDTH, height: 80, rows: [40] }];
        const scene = buildDataflowScene(graph, positions, () => null, () => false);
        expect(scene.inputs.map(i => [i.input.name, i.rowY, i.output])).toEqual([['min', 240, true]]);
        const edge = scene.edges.find(e => e.key === 'i')!;
        expect(start(edge.path)).toEqual([INPUT_BOX_WIDTH - DATAFLOW_LAYOUT.rowPadding, 240 + 16]);
        expect(scene.boxes[1].rows[0].input).toBe(true);
        expect(selectedEdges(scene, { scriptKey: -1, statementId: null, input: 'min' }).map(e => e.key)).toEqual(['i']);
        // A selected script highlights the edges of its inputs
        expect(selectedEdges(scene, { scriptKey: 2, statementId: null }).map(e => e.key)).toEqual(['b', 'i']);
        // Zoomed out, the input is its header
        const collapsed = buildDataflowScene(graph, positions, () => null, () => true, DATAFLOW_LAYOUT, true);
        expect(start(collapsed.edges.find(e => e.key === 'i')!.path)).toEqual([INPUT_BOX_WIDTH, 200 + DATAFLOW_LAYOUT.headerHeight / 2]);
    });

    it('curves a fan-out into the grid of its consumers after a trunk with one badge', () => {
        // A base box and five consumers in a grid of three columns, like the core lays them out
        const graph: DataflowGraph = {
            scripts: [script(1, 1), ...[2, 3, 4, 5, 6].map(key => script(key, 1))],
            inputs: [],
            edges: [2, 3, 4, 5, 6].map(key => ({
                key: `e${key}`,
                from: { scriptKey: 1, statementId: 0 },
                to: { scriptKey: key, statementId: 0 },
                kind: DataflowEdgeKind.Table,
                name: 'base',
                input: null,
            })),
        };
        const cell = (x: number, y: number) => ({ x, y, width: 280, height: 288, rows: [40] });
        const positions = [{ x: 0, y: 0, width: 280, height: 80, rows: [40] }, cell(376, 0), cell(688, 0), cell(1000, 0), cell(376, 320), cell(688, 320)];
        const scene = buildDataflowScene(graph, positions, () => null, () => false);
        // The trunk leaves room for the badge of 34 and a margin of 8 on both sides
        const [x1, trunk] = [280 - DATAFLOW_LAYOUT.rowPadding, 272 + 34 + 16];
        // Into the first row straight, behind the boxes in front of a later column
        expect(scene.edges[0].path).toBe(`M ${x1} 56 L 384 56`);
        expect(scene.edges[2].path).toBe(`M ${x1} 56 L 1008 56`);
        // Into the second row with a curve after the trunk, reaching at least 40 when the ports are close
        expect(scene.edges[3].path).toBe(`M ${x1} 56 L ${trunk} 56 C ${trunk + 40} 56, 344 376, 384 376`);
        expect(scene.edges[4].path).toBe(`M ${x1} 56 L ${trunk} 56 C ${trunk + 187} 56, ${696 - 187} 376, 696 376`);
        // One badge for the bus, on the trunk
        expect(scene.edges.map(e => e.badge).filter(b => b != null)).toEqual([{ x: (x1 + trunk) / 2, y: 56, width: 34, text: 'base' }]);
    });

    it('fits a scene into a viewport at most at its real size', () => {
        expect(fitDataflowScene({ x: 0, y: 0, width: 100, height: 100 }, 1000, 1000)).toEqual({ x: 450, y: 450, scale: 1 });
        const fit = fitDataflowScene({ x: 0, y: 0, width: 2000, height: 100 }, 1064, 600);
        expect(fit.scale).toBe(0.5);
    });
});
