import type * as core from '@ankoh/dashql-core';

import { type DataflowEdge, DataflowEdgeKind, type DataflowGraph, type DataflowInput, type DataflowPort, type DataflowScript, type DataflowStatement } from './dataflow_graph.js';

/// The sizes of the canvas, every row center is a multiple of the grid so that edges between snapped boxes are straight
export const DATAFLOW_LAYOUT: core.DataflowLayoutConfig = {
    boxWidth: 280,
    chartBoxWidth: 480,
    headerHeight: 32,
    rowHeight: 32,
    rowPadding: 8,
    chartHeight: 200,
    layerGap: 96,
    boxGap: 32,
    grid: 8,
    wrapSiblings: 4,
};

/// The width of the box of an input, like the dataflow snapshots of the core
export const INPUT_BOX_WIDTH = 200;

/// The bounds of the size of a resized box: its width and the height of its chart
export const DATAFLOW_MIN_BOX_WIDTH = 200;
export const DATAFLOW_MAX_BOX_WIDTH = 1600;
export const DATAFLOW_MIN_CHART_HEIGHT = 96;
export const DATAFLOW_MAX_CHART_HEIGHT = 1200;

/// Boxes are collapsed below this zoom, which leaves out the charts and merges the edges between boxes
export const DATAFLOW_COLLAPSE_SCALE = 0.5;

/// The space between an edge inside a box and the left border of the box, per statement that it spans
const INTERNAL_EDGE_GUTTER = 3;
const INTERNAL_EDGE_GUTTER_STEP = 2;
/// The least horizontal distance between the ports of an edge to a target on the right
const EDGE_STUB = 12;
/// The least reach of the control points of a curve between rows at different heights
const EDGE_CURVE = 40;
/// The reach of the control points of the bends of an edge back to a target on the left
const EDGE_LOOP = 48;
/// The space around the badge on the straight trunk of a bus
const EDGE_TRUNK_MARGIN = 8;
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
    collapsed: boolean;
    rows: DataflowSceneRow[];
    /// The chart below the visualized statement
    chart: Rect | null;
    /// Does an edge start at the box? Collapsed boxes have one port per side.
    input: boolean;
    output: boolean;
}

/// The box of an input: a header with the name and one row with the value
export interface DataflowSceneInput extends Rect {
    input: DataflowInput;
    collapsed: boolean;
    /// The top of the row of the value on the canvas
    rowY: number;
    /// Does an edge start at the input?
    output: boolean;
}

/// An edge
export interface DataflowSceneEdge {
    key: string;
    kind: DataflowEdgeKind;
    from: DataflowPort;
    to: DataflowPort;
    /// The input that an input edge starts at
    input: string | null;
    /// Do both ends lie in one box?
    internal: boolean;
    path: string;
    /// The name of the relation of a table edge, at the middle of the edge
    badge: { x: number; y: number; width: number; text: string } | null;
}

export interface DataflowScene {
    boxes: DataflowSceneBox[];
    inputs: DataflowSceneInput[];
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

/// The size of a resized box, null for the defaults of the layout
export interface DataflowBoxSize {
    width: number | null;
    chartHeight: number | null;
}

/// The inputs of the layout of a graph: a box per script, then a box of one row per input, and the edges between
/// statements of different boxes
export function dataflowLayoutInput(
    graph: DataflowGraph,
    fixed: (script: DataflowScript) => { x: number; y: number } | null,
    chartStatement: (script: DataflowScript) => number | null,
    collapsed: (script: DataflowScript) => boolean,
    fixedInput: (input: DataflowInput) => { x: number; y: number } | null = () => null,
    size: (script: DataflowScript) => DataflowBoxSize | null = () => null,
): { boxes: core.DataflowLayoutBox[]; edges: core.DataflowLayoutEdge[] } {
    const index = new Map(graph.scripts.map((s, i) => [s.scriptKey, i]));
    const inputIndex = new Map(graph.inputs.map((input, i) => [input.name, graph.scripts.length + i]));
    const boxes: core.DataflowLayoutBox[] = graph.scripts.map(script => {
        const isCollapsed = collapsed(script);
        const sized = size(script);
        return {
            statements: script.statements.length,
            chartStatement: isCollapsed ? null : chartStatement(script),
            collapsed: isCollapsed,
            fixed: fixed(script),
            ...(sized?.width != null ? { width: sized.width } : {}),
            ...(sized?.chartHeight != null ? { chartHeight: sized.chartHeight } : {}),
        };
    });
    for (const input of graph.inputs) {
        boxes.push({ statements: 1, width: INPUT_BOX_WIDTH, fixed: fixedInput(input), input: true });
    }
    const edges = graph.edges.flatMap(edge => {
        const fromBox = edge.input != null ? inputIndex.get(edge.input) : index.get(edge.from.scriptKey);
        const toBox = index.get(edge.to.scriptKey);
        if (fromBox == null || toBox == null || fromBox === toBox) return [];
        return [{ fromBox, fromStatement: edge.from.statementId, toBox, toStatement: edge.to.statementId }];
    });
    return { boxes, edges };
}

/// The height of the chart of a laid out box: the space between the row of the chart and the next row, or the bottom
export function dataflowChartHeight(p: DataflowBoxPosition, chartAt: number, config: core.DataflowLayoutConfig = DATAFLOW_LAYOUT): number {
    const top = (p.rows[chartAt] ?? 0) + config.rowHeight + config.rowPadding;
    const bottom = p.rows[chartAt + 1] ?? p.height - config.rowPadding;
    return Math.max(0, bottom - top);
}

/// A laid out box with another width and chart height, the rows below the chart move with its bottom
export function resizeDataflowBox(
    p: DataflowBoxPosition,
    chartAt: number | null,
    width: number,
    chartHeight: number | null,
    config: core.DataflowLayoutConfig = DATAFLOW_LAYOUT,
): DataflowBoxPosition {
    if (chartAt == null || chartHeight == null) return { ...p, width };
    const delta = chartHeight - dataflowChartHeight(p, chartAt, config);
    return { ...p, width, height: p.height + delta, rows: p.rows.map((y, i) => (i > chartAt ? y + delta : y)) };
}

/// The vertical center of the port of a statement on the canvas
function portY(box: DataflowSceneBox, statementId: number, config: core.DataflowLayoutConfig): number {
    const row = box.rows[statementId];
    if (box.collapsed || row == null) return box.y + config.headerHeight / 2;
    return row.y + config.rowHeight / 2;
}

/// The width of the frame that the ports of a box sit on: the statement rows, or the header of a collapsed box
function portFrameWidth(box: EdgeEnd, config: core.DataflowLayoutConfig): number {
    return box.collapsed ? box.width : box.width - 2 * config.rowPadding;
}

/// An orthogonal path through points with rounded corners
function roundedPath(points: [number, number][], radius: number): string {
    const out = [`M ${points[0][0]} ${points[0][1]}`];
    for (let i = 1; i < points.length - 1; ++i) {
        const [px, py] = points[i - 1];
        const [x, y] = points[i];
        const [nx, ny] = points[i + 1];
        const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
        const before = [x - Math.sign(x - px) * r, y - Math.sign(y - py) * r];
        const after = [x + Math.sign(nx - x) * r, y + Math.sign(ny - y) * r];
        out.push(`L ${before[0]} ${before[1]}`, `Q ${x} ${y}, ${after[0]} ${after[1]}`);
    }
    const [lx, ly] = points[points.length - 1];
    out.push(`L ${lx} ${ly}`);
    return out.join(' ');
}

/// The part of a box that edges are routed around
interface EdgeEnd extends Rect {
    collapsed: boolean;
}

/// The x of the output port of a box
function outputX(from: EdgeEnd, config: core.DataflowLayoutConfig): number {
    return from.x + (from.width + portFrameWidth(from, config)) / 2;
}

/// The x of the input port of a box
function inputX(to: EdgeEnd, config: core.DataflowLayoutConfig): number {
    return to.x + (to.width - portFrameWidth(to, config)) / 2;
}

/// The route of an edge from the output port of a row to the input port of a row of another box. A target to the
/// right is reached with a cubic curve that leaves and enters its ports horizontally, after a straight trunk out of
/// the source when the edge is part of a bus. A target to the left is reached with a loop around the boxes: a bend
/// out of the source, a straight run back between the boxes or below both, and a bend into the target. Returns the
/// path and the middle of the route.
function routeEdge(
    from: EdgeEnd,
    fromY: number,
    to: EdgeEnd,
    toY: number,
    config: core.DataflowLayoutConfig,
    trunk: number | null = null,
): { path: string; middle: [number, number] } {
    const x1 = outputX(from, config);
    const x2 = inputX(to, config);
    if (x2 - x1 >= 2 * EDGE_STUB) {
        if (fromY === toY) return { path: `M ${x1} ${fromY} L ${x2} ${toY}`, middle: [(x1 + x2) / 2, fromY] };
        const xs = trunk != null && x2 - trunk >= 2 * EDGE_STUB ? trunk : x1;
        const d = Math.max((x2 - xs) / 2, Math.min(Math.abs(toY - fromY), EDGE_CURVE));
        const head = xs === x1 ? `M ${x1} ${fromY}` : `M ${x1} ${fromY} L ${xs} ${fromY}`;
        // A symmetric cubic passes through the middle of its ends
        return { path: `${head} C ${xs + d} ${fromY}, ${x2 - d} ${toY}, ${x2} ${toY}`, middle: [(xs + x2) / 2, (fromY + toY) / 2] };
    }
    // Back around the boxes: between them if there is space, below both otherwise
    const [fromBottom, toBottom] = [from.y + from.height, to.y + to.height];
    let cy: number;
    if (to.y - fromBottom >= 2 * EDGE_STUB) cy = (fromBottom + to.y) / 2;
    else if (from.y - toBottom >= 2 * EDGE_STUB) cy = (toBottom + from.y) / 2;
    else cy = Math.max(fromBottom, toBottom) + config.boxGap / 2;
    // The bends turn at the ports, or both at the middle when the target is slightly right of the source
    const [ox, ix] = x2 <= x1 ? [x1, x2] : [(x1 + x2) / 2, (x1 + x2) / 2];
    const path = [
        `M ${x1} ${fromY}`,
        `C ${x1 + EDGE_LOOP} ${fromY}, ${ox + EDGE_LOOP} ${cy}, ${ox} ${cy}`,
        `L ${ix} ${cy}`,
        `C ${ix - EDGE_LOOP} ${cy}, ${x2 - EDGE_LOOP} ${toY}, ${x2} ${toY}`,
    ].join(' ');
    return { path, middle: [(ox + ix) / 2, cy] };
}

/// The path of an edge between two rows of one box, along the left border of the rows inside the padding of the box
function internalEdgePath(box: DataflowSceneBox, fromY: number, toY: number, span: number, config: core.DataflowLayoutConfig): string {
    const x = box.x + config.rowPadding;
    const gutter = Math.min(config.rowPadding - 1, INTERNAL_EDGE_GUTTER + INTERNAL_EDGE_GUTTER_STEP * Math.min(Math.max(span - 1, 0), 2));
    return roundedPath([[x, fromY], [x - gutter, fromY], [x - gutter, toY], [x, toY]], 3);
}

/// The width of a badge with a text
function edgeBadgeWidth(text: string): number {
    return Math.max(EDGE_BADGE_MIN_WIDTH, text.length * 6 + 10);
}

/// The scene of a graph with the positions of its boxes, in the order of the scripts, then the inputs
export function buildDataflowScene(
    graph: DataflowGraph,
    positions: DataflowBoxPosition[],
    chartStatement: (script: DataflowScript) => number | null,
    collapsed: (script: DataflowScript) => boolean,
    config: core.DataflowLayoutConfig = DATAFLOW_LAYOUT,
    /// Are the inputs drawn as their headers? The canvas collapses them when it is zoomed out.
    inputsCollapsed = false,
): DataflowScene {
    const boxes: DataflowSceneBox[] = graph.scripts.map((script, index) => {
        const p = positions[index];
        const isCollapsed = collapsed(script);
        const rows = script.statements.map((statement, i) => ({ statement, y: p.y + (p.rows[i] ?? 0), input: false, output: false }));
        const chartAt = isCollapsed ? null : chartStatement(script);
        const chartRow = chartAt != null ? rows[chartAt] : undefined;
        const chart = chartAt == null || chartRow == null ? null : {
            x: p.x + config.rowPadding,
            y: chartRow.y + config.rowHeight + config.rowPadding,
            width: p.width - 2 * config.rowPadding,
            height: dataflowChartHeight(p, chartAt, config),
        };
        const height = isCollapsed ? config.headerHeight : p.height;
        return { script, collapsed: isCollapsed, x: p.x, y: p.y, width: p.width, height, rows, chart, input: false, output: false };
    });
    const boxOf = new Map(boxes.map(b => [b.script.scriptKey, b]));
    const inputs: DataflowSceneInput[] = graph.inputs.flatMap((input, i) => {
        const p = positions[graph.scripts.length + i];
        if (p == null) return [];
        const height = inputsCollapsed ? config.headerHeight : p.height;
        return [{ input, collapsed: inputsCollapsed, x: p.x, y: p.y, width: p.width, height, rowY: p.y + (p.rows[0] ?? 0), output: false }];
    });
    const inputOf = new Map(inputs.map(i => [i.input.name, i]));

    // The table edges of a port with the same relation are a bus: they share a straight trunk out of the port with one
    // badge on it, when the nearest target on the right leaves room for it, and curve apart after it.
    const sourceOf = (edge: DataflowEdge): { key: string; end: EdgeEnd; y: number } | null => {
        if (edge.input != null) {
            const source = inputOf.get(edge.input);
            if (source == null) return null;
            return { key: `:${edge.input}`, end: source, y: source.collapsed ? source.y + config.headerHeight / 2 : source.rowY + config.rowHeight / 2 };
        }
        const from = boxOf.get(edge.from.scriptKey);
        if (from == null) return null;
        return { key: `${from.script.scriptKey}.${from.collapsed ? -1 : edge.from.statementId}`, end: from, y: portY(from, edge.from.statementId, config) };
    };
    const nearest = new Map<string, number>();
    const buses = new Map<string, number>();
    for (const edge of graph.edges) {
        const source = sourceOf(edge);
        const to = boxOf.get(edge.to.scriptKey);
        if (source == null || to == null || source.end === to) continue;
        const [x1, x2] = [outputX(source.end, config), inputX(to, config)];
        if (x2 - x1 >= 2 * EDGE_STUB) nearest.set(source.key, Math.min(nearest.get(source.key) ?? Infinity, x2));
        if (edge.kind === DataflowEdgeKind.Table) buses.set(`${source.key}:${edge.name}`, (buses.get(`${source.key}:${edge.name}`) ?? 0) + 1);
    }
    const trunkOf = (sourceKey: string, end: EdgeEnd, name: string): number | null => {
        if ((buses.get(`${sourceKey}:${name}`) ?? 0) < 2) return null;
        const x2 = nearest.get(sourceKey);
        const trunk = outputX(end, config) + edgeBadgeWidth(name) + 2 * EDGE_TRUNK_MARGIN;
        return x2 != null && x2 - trunk >= 2 * EDGE_STUB ? trunk : null;
    };
    const badged = new Set<string>();

    // Edges into collapsed boxes are merged, their statements are hidden
    const edges: DataflowSceneEdge[] = [];
    const merged = new Set<string>();
    for (const edge of graph.edges) {
        const to = boxOf.get(edge.to.scriptKey);
        if (to == null) continue;
        if (edge.input != null) {
            const source = inputOf.get(edge.input);
            if (source == null) continue;
            const toStatement = to.collapsed ? -1 : edge.to.statementId;
            if (to.collapsed) {
                const key = `:${edge.input}>${to.script.scriptKey}.${toStatement}`;
                if (merged.has(key)) continue;
                merged.add(key);
            }
            const fromY = source.collapsed ? source.y + config.headerHeight / 2 : source.rowY + config.rowHeight / 2;
            const { path } = routeEdge(source, fromY, to, portY(to, edge.to.statementId, config), config);
            source.output = true;
            const toRow = to.rows[edge.to.statementId];
            if (to.collapsed || toRow == null) to.input = true;
            else toRow.input = true;
            edges.push({ key: edge.key, kind: edge.kind, from: edge.from, to: edge.to, input: edge.input, internal: false, path, badge: null });
            continue;
        }
        const from = boxOf.get(edge.from.scriptKey);
        if (from == null) continue;
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
        const sourceKey = `${from.script.scriptKey}.${fromStatement}`;
        const trunk = internal || edge.kind !== DataflowEdgeKind.Table ? null : trunkOf(sourceKey, from, edge.name);
        let path: string;
        let middle: [number, number] = [0, 0];
        if (internal) {
            path = internalEdgePath(from, fromY, toY, Math.abs(edge.to.statementId - edge.from.statementId), config);
        } else {
            ({ path, middle } = routeEdge(from, fromY, to, toY, config, trunk));
        }
        // Collapsed boxes have one port per side, rows have their own
        const fromRow = from.rows[edge.from.statementId];
        const toRow = to.rows[edge.to.statementId];
        if (from.collapsed || fromRow == null) from.output = true;
        else if (internal) fromRow.input = true;
        else fromRow.output = true;
        if (to.collapsed || toRow == null) to.input = true;
        else toRow.input = true;
        let badge: DataflowSceneEdge['badge'] = null;
        if (edge.kind === DataflowEdgeKind.Table && !internal && edge.name.length > 0) {
            const bus = `${sourceKey}:${edge.name}`;
            if (trunk != null) {
                if (!badged.has(bus)) {
                    badged.add(bus);
                    badge = { x: (outputX(from, config) + trunk) / 2, y: fromY, width: edgeBadgeWidth(edge.name), text: edge.name };
                }
            } else {
                badge = { x: middle[0], y: middle[1], width: edgeBadgeWidth(edge.name), text: edge.name };
            }
        }
        edges.push({ key: edge.key, kind: edge.kind, from: edge.from, to: edge.to, input: null, internal, path, badge });
    }

    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const box of [...boxes, ...inputs]) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    }
    const bounds = boxes.length + inputs.length === 0 ? { x: 0, y: 0, width: 0, height: 0 } : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    return { boxes, inputs, edges, bounds };
}

/// What is selected on the canvas: a box, or a statement of it, or an input
export interface DataflowSelection {
    scriptKey: number;
    statementId: number | null;
    /// The selected input, the script key is `INPUT_PORT_SCRIPT_KEY` then
    input?: string;
}

/// The edges of a selection: of the selected statement, or of every statement of the selected box, or of the input
export function selectedEdges(scene: DataflowScene, selection: DataflowSelection | null): DataflowSceneEdge[] {
    if (selection == null) return [];
    if (selection.input != null) return scene.edges.filter(edge => edge.input === selection.input);
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

