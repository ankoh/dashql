import * as core from '@ankoh/dashql-core';
import { describe, expect, it } from 'vitest';

import { DataflowEdgeKind, type DataflowGraph, type DataflowScript } from './dataflow_graph.js';
import { buildDataflowScene, DATAFLOW_LAYOUT, dataflowLayoutInput, fitDataflowScene, selectedEdges } from './dataflow_scene.js';

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
    edges: [
        { key: 'a', from: { scriptKey: 1, statementId: 0 }, to: { scriptKey: 1, statementId: 1 }, kind: DataflowEdgeKind.Table, name: 't' },
        { key: 'b', from: { scriptKey: 1, statementId: 1 }, to: { scriptKey: 2, statementId: 0 }, kind: DataflowEdgeKind.Table, name: 't' },
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

    it('merges the edges of collapsed boxes and leaves out the edges inside them', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, () => null, () => true);
        expect(scene.edges.map(e => e.key)).toEqual(['b']);
        expect(start(scene.edges[0].path)).toEqual([280, DATAFLOW_LAYOUT.headerHeight / 2]);
        expect(scene.boxes[0].output).toBe(true);
        expect(scene.boxes[1].input).toBe(true);
    });

    it('places the chart below the visualized statement', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, s => (s.scriptKey === 2 ? 0 : null), () => false);
        expect(scene.boxes[1].chart).toEqual({ x: 384, y: 32 + 40 + 32 + 8, width: 264, height: DATAFLOW_LAYOUT.chartHeight });
        expect(scene.boxes[0].chart).toBeNull();
    });

    it('selects the edges of a statement or of a box', () => {
        const scene = buildDataflowScene(GRAPH, POSITIONS, () => null, () => false);
        expect(selectedEdges(scene, { scriptKey: 1, statementId: 0 }).map(e => e.key)).toEqual(['a']);
        expect(selectedEdges(scene, { scriptKey: 1, statementId: null }).map(e => e.key)).toEqual(['a', 'b']);
        expect(selectedEdges(scene, null)).toEqual([]);
    });

    it('fits a scene into a viewport at most at its real size', () => {
        expect(fitDataflowScene({ x: 0, y: 0, width: 100, height: 100 }, 1000, 1000)).toEqual({ x: 450, y: 450, scale: 1 });
        const fit = fitDataflowScene({ x: 0, y: 0, width: 2000, height: 100 }, 1064, 600);
        expect(fit.scale).toBe(0.5);
    });
});
