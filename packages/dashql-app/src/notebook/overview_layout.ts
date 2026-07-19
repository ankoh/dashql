import {
    EdgeType,
    NodePort,
    PathBuilder,
    PORTS_FROM,
    PORTS_TO,
    buildEdgePathBetweenRectangles,
    selectEdgeType,
} from '../utils/graph_edges.js';
import { NotebookPageScript } from './notebook_types.js';
import { PageDependency } from './overview_dependencies.js';

/// Layout constants for the overview map. Uniform, fixed card size (no
/// measure→relayout pass) so edge geometry is exact.
export interface OverviewLayoutConfig {
    /// Card width in pixels.
    cardWidth: number;
    /// Card height in pixels.
    cardHeight: number;
    /// Horizontal gap between adjacent columns.
    colGap: number;
    /// Vertical gap between adjacent rows.
    rowGap: number;
    /// Padding around the whole grid (applied to both layers so coordinates align).
    padding: number;
    /// Corner radius of the rounded edge turns.
    cornerRadius: number;
    /// Lateral separation between parallel edges sharing a port.
    offsetStep: number;
}

export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayoutConfig = {
    cardWidth: 200,
    cardHeight: 132,
    colGap: 56,
    rowGap: 56,
    padding: 32,
    cornerRadius: 6,
    offsetStep: 10,
};

/// The placed rectangle for one card. `left`/`top` are the CSS position of the
/// card's top-left corner; `centerX`/`centerY` are used for edge geometry. Both
/// live in the same padded coordinate space shared by the node and edge layers.
export interface OverviewRect {
    scriptId: number;
    fileName: string;
    feedIndex: number;
    col: number;
    row: number;
    left: number;
    top: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
}

/// A precomputed edge ready to render: the SVG path string plus the ports it
/// attaches to on each card, so both the edge layer and the card ports are pure
/// renders over the layout output.
export interface OverviewEdge {
    /// The source (referenced, earlier) entry's scriptId.
    fromScriptId: number;
    /// The dependent (referencing, later) entry's scriptId.
    toScriptId: number;
    /// Port on the source card where the edge leaves.
    fromPort: NodePort;
    /// Port on the dependent card where the edge enters.
    toPort: NodePort;
    /// The rendered SVG path `d` attribute.
    path: string;
    /// Whether this edge touches the focused card (rendered on top, heavier stroke).
    focused: boolean;
}

/// The full overview layout: card rectangles, canvas dimensions, edges, and the
/// per-card port bitmask (union of every port an edge attaches to that card).
export interface OverviewLayout {
    config: OverviewLayoutConfig;
    rectByScriptId: Map<number, OverviewRect>;
    /// Union of the ports each card has an edge on (bitmask of NodePort values).
    portsByScriptId: Map<number, number>;
    edges: OverviewEdge[];
    canvasWidth: number;
    canvasHeight: number;
    gridCols: number;
}

/// The number of columns the grid wraps at for a given available width. At least
/// one column so a narrow container still lays out (cards may overflow-x then).
export function computeGridCols(availableWidth: number, config: OverviewLayoutConfig): number {
    const usable = availableWidth - 2 * config.padding + config.colGap;
    return Math.max(1, Math.floor(usable / (config.cardWidth + config.colGap)));
}

/// Lay out a notebook page's entries into a deterministic row-major grid (feed
/// order, left-to-right, wrapping at `gridCols`) and precompute the dependency
/// edges drawn between the cards.
///
/// Fully pure and deterministic: same inputs → identical output. No layout
/// metadata is read or persisted; positions come from feed order + width, edges
/// from the analyzer-derived `dependencies`.
export function layoutOverview(
    entries: NotebookPageScript[],
    dependencies: PageDependency[],
    availableWidth: number,
    focusedScriptId: number | null = null,
    config: OverviewLayoutConfig = DEFAULT_OVERVIEW_LAYOUT,
): OverviewLayout {
    const gridCols = computeGridCols(availableWidth, config);

    // Place each entry into the grid in feed order.
    const rectByScriptId = new Map<number, OverviewRect>();
    entries.forEach((entry, feedIndex) => {
        const col = feedIndex % gridCols;
        const row = Math.floor(feedIndex / gridCols);
        const left = config.padding + col * (config.cardWidth + config.colGap);
        const top = config.padding + row * (config.cardHeight + config.rowGap);
        rectByScriptId.set(entry.scriptId, {
            scriptId: entry.scriptId,
            fileName: entry.fileName,
            feedIndex,
            col,
            row,
            left,
            top,
            width: config.cardWidth,
            height: config.cardHeight,
            centerX: left + config.cardWidth / 2,
            centerY: top + config.cardHeight / 2,
        });
    });

    const usedRows = entries.length === 0 ? 0 : Math.ceil(entries.length / gridCols);
    const usedCols = entries.length === 0 ? 0 : Math.min(entries.length, gridCols);
    const canvasWidth = usedCols === 0
        ? 2 * config.padding
        : 2 * config.padding + usedCols * config.cardWidth + (usedCols - 1) * config.colGap;
    const canvasHeight = usedRows === 0
        ? 2 * config.padding
        : 2 * config.padding + usedRows * config.cardHeight + (usedRows - 1) * config.rowGap;

    // First pass: geometry, edge type, and ports for every drawable dependency.
    // Edges are drawn source → dependent (earlier → later), matching reading order.
    interface PreparedEdge {
        dep: PageDependency;
        from: OverviewRect;
        to: OverviewRect;
        edgeType: EdgeType;
        fromPort: NodePort;
        toPort: NodePort;
    }
    const prepared: PreparedEdge[] = [];
    for (const dep of dependencies) {
        const from = rectByScriptId.get(dep.to); // source (referenced, earlier)
        const to = rectByScriptId.get(dep.from); // dependent (referencing, later)
        if (!from || !to) continue;
        const edgeType = selectEdgeType(from.centerX, from.centerY, to.centerX, to.centerY, config.cardWidth, config.cardHeight);
        prepared.push({
            dep,
            from,
            to,
            edgeType,
            fromPort: PORTS_FROM[edgeType] as NodePort,
            toPort: PORTS_TO[edgeType] as NodePort,
        });
    }

    // Assign a deterministic lateral offset to edges that leave the same source
    // card on the same port, so parallel edges fan out instead of overlapping.
    // Ordered by the dependent's feed index for stability.
    const groups = new Map<string, PreparedEdge[]>();
    for (const pe of prepared) {
        const key = `${pe.from.scriptId}:${pe.fromPort}`;
        const group = groups.get(key);
        if (group) group.push(pe);
        else groups.set(key, [pe]);
    }
    const offsetByEdge = new Map<PreparedEdge, number>();
    for (const group of groups.values()) {
        group.sort((a, b) => a.dep.fromFeedIndex - b.dep.fromFeedIndex);
        const n = group.length;
        group.forEach((pe, i) => {
            offsetByEdge.set(pe, (i - (n - 1) / 2) * config.offsetStep);
        });
    }

    // Second pass: render each edge's path and accumulate per-card port bitmasks.
    const portsByScriptId = new Map<number, number>();
    const addPort = (scriptId: number, port: NodePort) => {
        portsByScriptId.set(scriptId, (portsByScriptId.get(scriptId) ?? 0) | port);
    };
    const builder = new PathBuilder();
    const edges: OverviewEdge[] = [];
    for (const pe of prepared) {
        const offset = offsetByEdge.get(pe) ?? 0;
        buildEdgePathBetweenRectangles(
            builder,
            pe.edgeType,
            pe.from.centerX,
            pe.from.centerY,
            pe.to.centerX,
            pe.to.centerY,
            config.cardWidth,
            config.cardHeight,
            config.cardWidth,
            config.cardHeight,
            config.cornerRadius,
            offset,
        );
        addPort(pe.from.scriptId, pe.fromPort);
        addPort(pe.to.scriptId, pe.toPort);
        edges.push({
            fromScriptId: pe.from.scriptId,
            toScriptId: pe.to.scriptId,
            fromPort: pe.fromPort,
            toPort: pe.toPort,
            path: builder.render(),
            focused: focusedScriptId != null && (pe.from.scriptId === focusedScriptId || pe.to.scriptId === focusedScriptId),
        });
    }

    return {
        config,
        rectByScriptId,
        portsByScriptId,
        edges,
        canvasWidth,
        canvasHeight,
        gridCols,
    };
}
