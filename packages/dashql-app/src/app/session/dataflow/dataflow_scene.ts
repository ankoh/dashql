import type * as core from '@ankoh/dashql-core';

import { buildEdgePathBetweenRectangles, PathBuilder, selectHorizontalEdgeType } from '../compute/ui/graph/graph_edges.js';
import { DataflowEdgeKind, type DataflowEdge, type DataflowGraph, type DataflowPort, type DataflowScript, type DataflowStatement } from './dataflow_graph.js';

/// The sizes of the canvas, every row center is a multiple of the grid so that edges between snapped boxes are straight
export const DATAFLOW_LAYOUT: core.DataflowLayoutConfig = {
    boxWidth: 280,
    headerHeight: 32,
    rowHeight: 32,
    rowPadding: 8,
    chartHeight: 200,
    layerGap: 96,
    boxGap: 32,
    grid: 8,
};

/// Boxes are collapsed below this zoom, which leaves out the charts and merges the edges between boxes
export const DATAFLOW_COLLAPSE_SCALE = 0.5;

/// The space between an edge inside a box and the left border of the box, per statement that it spans
const INTERNAL_EDGE_GUTTER = 4;
const INTERNAL_EDGE_GUTTER_STEP = 3;
const EDGE_CORNER_RADIUS = 4;
export const EDGE_BADGE_HEIGHT = 15;
const EDGE_BADGE_MIN_WIDTH = 25;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/// A statement row of a box
export interface DataflowSceneRow {
    statement: DataflowStatement;
    /// The top of the row on the canvas
    y: number;
    /// Do edges end or start at the row?
    input: boolean;
    output: boolean;
}

/// A script box
export interface DataflowSceneBox extends Rect {
    script: DataflowScript;
    /// The index of the script in the session, it picks the color of the box
    index: number;
    collapsed: boolean;
    rows: DataflowSceneRow[];
    /// The chart below the visualized statement
    chart: Rect | null;
    /// Does an edge start at the box? Collapsed boxes have one port per side.
    input: boolean;
    output: boolean;
}

/// An edge
export interface DataflowSceneEdge {
    key: string;
    kind: DataflowEdgeKind;
    from: DataflowPort;
    to: DataflowPort;
    /// Do both ends lie in one box?
    internal: boolean;
    path: string;
    /// The name of the relation of a table edge, at the middle of the edge
    badge: { x: number; y: number; width: number; text: string } | null;
}

export interface DataflowScene {
    boxes: DataflowSceneBox[];
    edges: DataflowSceneEdge[];
    /// The bounds of the boxes
    bounds: Rect;
}

/// The position and size of a box, from the layout
export interface DataflowBoxPosition {
    x: number;
    y: number;
    width: number;
    height: number;
    rows: number[];
}

/// The inputs of the layout of a graph: a box per script and the edges between statements of different scripts
export function dataflowLayoutInput(
    graph: DataflowGraph,
    fixed: (script: DataflowScript) => { x: number; y: number } | null,
    chartStatement: (script: DataflowScript) => number | null,
    collapsed: (script: DataflowScript) => boolean,
): { boxes: core.DataflowLayoutBox[]; edges: core.DataflowLayoutEdge[] } {
    const index = new Map(graph.scripts.map((s, i) => [s.scriptKey, i]));
    const boxes = graph.scripts.map(script => {
        const isCollapsed = collapsed(script);
        return {
            statements: script.statements.length,
            chartStatement: isCollapsed ? null : chartStatement(script),
            collapsed: isCollapsed,
            fixed: fixed(script),
        };
    });
    const edges = graph.edges.flatMap(edge => {
        const fromBox = index.get(edge.from.scriptKey);
        const toBox = index.get(edge.to.scriptKey);
        if (fromBox == null || toBox == null || fromBox === toBox) return [];
        return [{ fromBox, fromStatement: edge.from.statementId, toBox, toStatement: edge.to.statementId }];
    });
    return { boxes, edges };
}

/// The vertical center of the port of a statement on the canvas
function portY(box: DataflowSceneBox, statementId: number, config: core.DataflowLayoutConfig): number {
    const row = box.rows[statementId];
    if (box.collapsed || row == null) return box.y + config.headerHeight / 2;
    return row.y + config.rowHeight / 2;
}

/// The width of the frame that the ports of a box sit on: the statement rows, or the header of a collapsed box
export function portFrameWidth(box: DataflowSceneBox, config: core.DataflowLayoutConfig): number {
    return box.collapsed ? box.width : box.width - 2 * config.rowPadding;
}

/// The path of an edge between two boxes, from the right of the source row to the left of the target row
function edgePath(from: DataflowSceneBox, fromY: number, to: DataflowSceneBox, toY: number, config: core.DataflowLayoutConfig): string {
    const height = config.rowHeight;
    const [fromX, toX] = [from.x + from.width / 2, to.x + to.width / 2];
    const type = selectHorizontalEdgeType(fromX, fromY, toX, toY);
    const [fromWidth, toWidth] = [portFrameWidth(from, config), portFrameWidth(to, config)];
    return buildEdgePathBetweenRectangles(new PathBuilder(), type, fromX, fromY, toX, toY, fromWidth, height, toWidth, height, EDGE_CORNER_RADIUS).render();
}

/// The path of an edge between two rows of one box, along the left border of the rows
function internalEdgePath(box: DataflowSceneBox, fromY: number, toY: number, span: number, config: core.DataflowLayoutConfig): string {
    const x = box.x + config.rowPadding;
    const gutter = INTERNAL_EDGE_GUTTER + INTERNAL_EDGE_GUTTER_STEP * Math.min(Math.max(span - 1, 0), 4);
    const r = Math.min(EDGE_CORNER_RADIUS, Math.abs(toY - fromY) / 2);
    const dir = toY >= fromY ? 1 : -1;
    const left = x - gutter;
    return `M ${x} ${fromY} L ${left + r} ${fromY} Q ${left} ${fromY}, ${left} ${fromY + dir * r} `
        + `L ${left} ${toY - dir * r} Q ${left} ${toY}, ${left + r} ${toY} L ${x} ${toY}`;
}

/// The width of a badge with a text
export function edgeBadgeWidth(text: string): number {
    return Math.max(EDGE_BADGE_MIN_WIDTH, text.length * 6 + 10);
}

/// The scene of a graph with the positions of its boxes, in the order of the scripts
export function buildDataflowScene(
    graph: DataflowGraph,
    positions: DataflowBoxPosition[],
    chartStatement: (script: DataflowScript) => number | null,
    collapsed: (script: DataflowScript) => boolean,
    config: core.DataflowLayoutConfig = DATAFLOW_LAYOUT,
): DataflowScene {
    const boxes: DataflowSceneBox[] = graph.scripts.map((script, index) => {
        const p = positions[index];
        const isCollapsed = collapsed(script);
        const rows = script.statements.map((statement, i) => ({ statement, y: p.y + (p.rows[i] ?? 0), input: false, output: false }));
        const chartAt = isCollapsed ? null : chartStatement(script);
        const chartRow = chartAt != null ? rows[chartAt] : undefined;
        const chart = chartRow == null ? null : {
            x: p.x + config.rowPadding,
            y: chartRow.y + config.rowHeight + config.rowPadding,
            width: p.width - 2 * config.rowPadding,
            height: config.chartHeight,
        };
        return { script, index, collapsed: isCollapsed, x: p.x, y: p.y, width: p.width, height: p.height, rows, chart, input: false, output: false };
    });
    const boxOf = new Map(boxes.map(b => [b.script.scriptKey, b]));

    // Edges into collapsed boxes are merged, their statements are hidden
    const edges: DataflowSceneEdge[] = [];
    const merged = new Set<string>();
    for (const edge of graph.edges) {
        const from = boxOf.get(edge.from.scriptKey);
        const to = boxOf.get(edge.to.scriptKey);
        if (from == null || to == null) continue;
        const internal = from === to;
        if (internal && from.collapsed) continue;
        const fromStatement = from.collapsed ? -1 : edge.from.statementId;
        const toStatement = to.collapsed ? -1 : edge.to.statementId;
        if (from.collapsed || to.collapsed) {
            const key = `${from.script.scriptKey}.${fromStatement}>${to.script.scriptKey}.${toStatement}:${edge.kind}`;
            if (merged.has(key)) continue;
            merged.add(key);
        }
        const fromY = portY(from, edge.from.statementId, config);
        const toY = portY(to, edge.to.statementId, config);
        let path: string;
        if (internal) {
            path = internalEdgePath(from, fromY, toY, Math.abs(edge.to.statementId - edge.from.statementId), config);
        } else {
            path = edgePath(from, fromY, to, toY, config);
        }
        // Collapsed boxes have one port per side, rows have their own
        const fromRow = from.rows[edge.from.statementId];
        const toRow = to.rows[edge.to.statementId];
        if (from.collapsed || fromRow == null) from.output = true;
        else if (internal) fromRow.input = true;
        else fromRow.output = true;
        if (to.collapsed || toRow == null) to.input = true;
        else toRow.input = true;
        const badge = edge.kind === DataflowEdgeKind.Table && !internal && edge.name.length > 0
            ? { x: (from.x + from.width + to.x) / 2, y: (fromY + toY) / 2, width: edgeBadgeWidth(edge.name), text: edge.name }
            : null;
        edges.push({ key: edge.key, kind: edge.kind, from: edge.from, to: edge.to, internal, path, badge });
    }

    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const box of boxes) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    }
    const bounds = boxes.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    return { boxes, edges, bounds };
}

/// What is selected on the canvas: a box, or a statement of it
export interface DataflowSelection {
    scriptKey: number;
    statementId: number | null;
}

/// The edges of a selection: of the selected statement, or of every statement of the selected box
export function selectedEdges(scene: DataflowScene, selection: DataflowSelection | null): DataflowSceneEdge[] {
    if (selection == null) return [];
    const touches = (port: DataflowPort) => port.scriptKey === selection.scriptKey
        && (selection.statementId == null || port.statementId === selection.statementId);
    return scene.edges.filter(edge => touches(edge.from) || touches(edge.to));
}

/// The transform that fits a scene into a viewport: centered, at most at its real size and at least at `minScale`
export function fitDataflowScene(bounds: Rect, viewportWidth: number, viewportHeight: number, padding = 32, minScale = 0.25): { x: number; y: number; scale: number } {
    if (bounds.width <= 0 || bounds.height <= 0) return { x: padding, y: padding, scale: 1 };
    const scale = Math.max(minScale, Math.min(1, (viewportWidth - 2 * padding) / bounds.width, (viewportHeight - 2 * padding) / bounds.height));
    const x = (viewportWidth - bounds.width * scale) / 2 - bounds.x * scale;
    const y = Math.max(padding, (viewportHeight - bounds.height * scale) / 2) - bounds.y * scale;
    return { x, y, scale };
}

