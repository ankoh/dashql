import * as glue from './wasm/dashql_dataflow.js';

/// The wasm-bindgen module of the layout of the dataflow canvas (`packages/dashql-dataflow-wasm`)
export type DashQLDataflowBindings = Pick<typeof glue, 'DataflowLayout' | 'routeDataflowEdges' | 'installPanicHook'>;

/// The sizes of the dataflow canvas, in canvas pixels
export interface DataflowLayoutConfig {
    boxWidth: number;
    /// The width of a box with a chart, a chart or a table is wider than high
    chartBoxWidth: number;
    /// The height of the header of a box, a collapsed box is its header
    headerHeight: number;
    rowHeight: number;
    /// The space between the header, the rows and the bottom of a box
    rowPadding: number;
    /// The height of the chart below a visualized statement
    chartHeight: number;
    layerGap: number;
    boxGap: number;
    /// The grid that drags and resizes on the canvas snap to, the layout does not snap
    grid: number;
    /// The fewest sinks of a fan-out that alternate between sub-layers, 0 never
    wrapSiblings: number;
    /// The width over the height that the parts of the graph are packed for, e.g. of the viewport
    aspectRatio?: number;
}

/// A script box of the dataflow canvas
export interface DataflowLayoutBox {
    statements: number;
    /// The statement whose chart follows its row
    chartStatement?: number | null;
    collapsed?: boolean;
    /// The width of the box, the width of the config if absent, the chart box width with a chart
    width?: number | null;
    /// The height of the chart of the box, the chart height of the config if absent
    chartHeight?: number | null;
    /// Is the box an input or an attachment? Its consumers are grouped as if it were absent.
    input?: boolean;
    /// Where the box was, e.g. saved in its `@flow` tag. With hints the boxes keep their columns, their order in a
    /// column and their y.
    hint?: { x: number; y: number } | null;
    /// Was the box just dropped at its hint by the user? The other hints place the layout.
    dropped?: boolean;
}

/// An edge between statements of two boxes
export interface DataflowLayoutEdge {
    fromBox: number;
    fromStatement: number;
    toBox: number;
    toStatement: number;
}

/// A point of the dataflow canvas
export type DataflowPoint = [number, number];

/// An edge to route around the boxes of the dataflow canvas: from a point on the right border of a box to a point on
/// the left border of a box
export interface DataflowRouteEdge {
    from: DataflowPoint;
    to: DataflowPoint;
}

/// The route of an edge between boxes that the layout arranged: a polyline of horizontal and vertical segments from
/// the right border of the source box to the left border of the target box, at the rows of the statements
export interface DataflowLayoutRoute {
    fromBox: number;
    fromStatement: number;
    toBox: number;
    toStatement: number;
    points: DataflowPoint[];
}

/// The geometry of a box
export interface DataflowBoxGeometry {
    x: number;
    y: number;
    width: number;
    height: number;
    /// The top of every statement row, relative to the box. The rows of a collapsed box are its header.
    rows: number[];
}

/// Load the wasm binary of the layout next to this module
async function loadDefaultDataflowWasm(): Promise<Uint8Array | URL> {
    const url = new URL('./wasm/dashql_dataflow.wasm', import.meta.url);
    if (url.protocol === 'file:') {
        // Node: fetch does not support file URLs. The specifier is not static to keep bundlers away.
        const fs = 'node:fs/promises';
        const { readFile } = await import(/* @vite-ignore */ fs);
        return new Uint8Array(await readFile(url));
    }
    return url;
}

/// The options of the layout module
export interface DashQLDataflowOptions {
    /// The wasm binary
    wasmBinary?: Uint8Array | ArrayBuffer;
    /// A precompiled wasm module, takes precedence over the binary
    module?: WebAssembly.Module;
}

let instantiated: Promise<void> | null = null;

/// The layout of the dataflow canvas: ELK places the boxes and routes the edges, and orthogonal routes go around boxes
/// at any position. A wasm module of its own, so that the core module does not carry ELK: create it when the canvas
/// opens. A wasm-bindgen module is instantiated once per JS module, the instances share it.
export class DashQLDataflow {
    bindings: DashQLDataflowBindings;

    public constructor(bindings: DashQLDataflowBindings) {
        this.bindings = bindings;
        bindings.installPanicHook();
    }

    /// Create a layout instance, the module is instantiated by the first one
    public static async create(options?: DashQLDataflowOptions): Promise<DashQLDataflow> {
        instantiated ??= (async () => {
            const moduleOrPath = options?.module ?? options?.wasmBinary ?? await loadDefaultDataflowWasm();
            await glue.default({ module_or_path: moduleOrPath });
        })();
        try {
            await instantiated;
        } catch (e) {
            instantiated = null;
            throw e;
        }
        // A plain copy of the module namespace, the namespace itself is frozen
        return new DashQLDataflow({ ...glue });
    }

    /// Lay out the boxes of the dataflow canvas, see docs/design/dataflow.md: from scratch without hints, from where
    /// the boxes were with hints
    public computeDataflowLayout(boxes: DataflowLayoutBox[], edges: DataflowLayoutEdge[], config?: DataflowLayoutConfig): DataflowBoxGeometry[] {
        return this.computeDataflowLayoutWithRoutes(boxes, edges, config).boxes;
    }

    /// Lay out the boxes of the dataflow canvas like `computeDataflowLayout`, with the routes of the edges between
    /// boxes
    public computeDataflowLayoutWithRoutes(
        boxes: DataflowLayoutBox[],
        edges: DataflowLayoutEdge[],
        config?: DataflowLayoutConfig,
    ): { boxes: DataflowBoxGeometry[]; routes: DataflowLayoutRoute[] } {
        const layout = new this.bindings.DataflowLayout();
        try {
            if (config) {
                layout.setConfig(config.boxWidth, config.chartBoxWidth, config.headerHeight, config.rowHeight, config.rowPadding, config.chartHeight, config.layerGap, config.boxGap, config.wrapSiblings);
                if (config.aspectRatio != null && config.aspectRatio > 0) layout.setAspectRatio(config.aspectRatio);
            }
            for (const box of boxes) {
                layout.addBox(
                    box.statements,
                    box.chartStatement ?? -1,
                    box.collapsed ?? false,
                    box.width ?? 0,
                    box.chartHeight ?? 0,
                    box.input ?? false,
                    box.hint != null,
                    box.hint?.x ?? 0,
                    box.hint?.y ?? 0,
                    box.dropped ?? false,
                );
            }
            for (const edge of edges) {
                layout.addEdge(edge.fromBox, edge.fromStatement, edge.toBox, edge.toStatement);
            }
            const flat = layout.compute();
            const geometry = boxes.map((_, i) => ({
                x: flat[i * 4],
                y: flat[i * 4 + 1],
                width: flat[i * 4 + 2],
                height: flat[i * 4 + 3],
                rows: Array.from(layout.rows(i)),
            }));
            const flatRoutes = layout.routes();
            const routes: DataflowLayoutRoute[] = [];
            for (let at = 0; at < flatRoutes.length; ) {
                const [fromBox, fromStatement, toBox, toStatement, count] = flatRoutes.slice(at, at + 5);
                at += 5;
                const points: DataflowPoint[] = [];
                for (let p = 0; p < count; ++p, at += 2) points.push([flatRoutes[at], flatRoutes[at + 1]]);
                routes.push({ fromBox, fromStatement, toBox, toStatement, points });
            }
            return { boxes: geometry, routes };
        } finally {
            layout.free();
        }
    }

    /// Route edges of the dataflow canvas around its boxes as polylines of horizontal and vertical segments. An edge
    /// leaves the right border of its source box and enters the left border of its target box; null for an edge
    /// without a way around the boxes.
    public routeDataflowEdges(boxes: { x: number; y: number; width: number; height: number }[], edges: DataflowRouteEdge[]): (DataflowPoint[] | null)[] {
        const flatBoxes = new Float64Array(boxes.length * 4);
        boxes.forEach((b, i) => flatBoxes.set([b.x, b.y, b.width, b.height], i * 4));
        const flatEdges = new Float64Array(edges.length * 4);
        edges.forEach((e, i) => flatEdges.set([e.from[0], e.from[1], e.to[0], e.to[1]], i * 4));
        const flat = this.bindings.routeDataflowEdges(flatBoxes, flatEdges);
        const routes: (DataflowPoint[] | null)[] = [];
        let at = 0;
        for (let i = 0; i < edges.length; ++i) {
            const count = flat[at++];
            const points: DataflowPoint[] = [];
            for (let p = 0; p < count; ++p, at += 2) points.push([flat[at], flat[at + 1]]);
            routes.push(points.length > 0 ? points : null);
        }
        return routes;
    }
}
