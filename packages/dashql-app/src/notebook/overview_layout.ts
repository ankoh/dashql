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
import { PageDependencies, PageDependency } from './overview_dependencies.js';

/// Layout constants for the overview map. Uniform, fixed card size (no
/// measure→relayout pass) so edge geometry is exact.
export interface OverviewLayoutConfig {
    /// Card width in pixels.
    scriptCardWidth: number;
    /// Card height in pixels.
    scriptCardHeight: number;
    /// Horizontal gap between adjacent columns.
    scriptCardColGap: number;
    /// Vertical gap between adjacent rows.
    scriptCardRowGap: number;
    /// Padding around the whole grid (applied to both layers so coordinates align).
    outerGridPadding: number;
    /// Corner radius of the rounded edge turns.
    edgeCornerRadius: number;
    /// Width of a page-reference placeholder card in the top bar.
    pageCardWidth: number;
    /// Height of a page-reference placeholder card in the top bar.
    pageCardHeight: number;
    /// Horizontal gap between adjacent page-reference cards.
    pageCardGap: number;
    /// Vertical gap between wrapped page-reference card rows.
    pageRowGap: number;
    /// Vertical gap between the page-reference bar and the top of the grid.
    pageBarGap: number;
}

export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayoutConfig = {
    scriptCardWidth: 200,
    scriptCardHeight: 132,
    scriptCardColGap: 40,
    scriptCardRowGap: 16,
    outerGridPadding: 32,
    edgeCornerRadius: 6,
    pageCardWidth: 160,
    pageCardHeight: 28,
    pageCardGap: 20,
    pageRowGap: 16,
    pageBarGap: 40,
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

/// A placed placeholder card for a referenced *other* page, sitting in the bar
/// above the grid. `centerX`/`centerY` feed the same edge geometry as grid cards.
export interface PageRefRect {
    /// The clean (display) name of the referenced page. Also the layout key.
    pageName: string;
    /// Number of entries on the current page that reference this page (badge count).
    refCount: number;
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

/// A precomputed edge between a page-reference card (source) and a grid card that
/// references it (dependent). Rendered on the same layer as `OverviewEdge` but kept
/// separate so it can carry a distinct "leaves this page" style.
export interface PageRefEdge {
    /// The referenced page's name (source, in the bar).
    fromPageName: string;
    /// The referencing grid entry's scriptId (dependent).
    toScriptId: number;
    /// Port on the page card where the edge leaves.
    fromPort: NodePort;
    /// Port on the grid card where the edge enters.
    toPort: NodePort;
    /// The rendered SVG path `d` attribute.
    path: string;
    /// Whether this edge touches the focused grid card.
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
    /// Placeholder cards for referenced other pages, laid out in the top bar.
    pageRefRects: PageRefRect[];
    /// Edges from page-reference cards to the grid cards that reference them.
    pageRefEdges: PageRefEdge[];
    /// Union of ports each page card has an edge on, keyed by page name.
    portsByPageName: Map<string, number>;
    canvasWidth: number;
    canvasHeight: number;
    gridCols: number;
}

/// The number of columns the grid wraps at for a given available width. At least
/// one column so a narrow container still lays out (cards may overflow-x then).
export function computeGridCols(availableWidth: number, config: OverviewLayoutConfig): number {
    const usable = availableWidth - 2 * config.outerGridPadding + config.scriptCardColGap;
    return Math.max(1, Math.floor(usable / (config.scriptCardWidth + config.scriptCardColGap)));
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
    dependencies: PageDependencies,
    availableWidth: number,
    focusedScriptId: number | null = null,
    config: OverviewLayoutConfig = DEFAULT_OVERVIEW_LAYOUT,
): OverviewLayout {
    const gridCols = computeGridCols(availableWidth, config);

    // Reserve a band above the grid for the page-reference cards when there are cross-page refs, so
    // the grid drops down to make room. The cards wrap into a left-aligned grid (same as the entry
    // grid, but with the narrower page-card width), so the band grows one row at a time.
    const pageNames = Array.from(new Set(dependencies.crossPage.map(d => d.targetPageName)));
    const pageRefCols = computeGridCols(availableWidth, {
        ...config,
        scriptCardWidth: config.pageCardWidth,
        scriptCardColGap: config.pageCardGap,
    });
    const pageRefRows = pageNames.length === 0 ? 0 : Math.ceil(pageNames.length / pageRefCols);
    const barHeight = pageRefRows === 0
        ? 0
        : pageRefRows * config.pageCardHeight + (pageRefRows - 1) * config.pageRowGap;
    const bandHeight = pageNames.length > 0 ? barHeight + config.pageBarGap : 0;
    const gridTop = config.outerGridPadding + bandHeight;

    // Place each entry into the grid in feed order.
    const rectByScriptId = new Map<number, OverviewRect>();
    entries.forEach((entry, feedIndex) => {
        const col = feedIndex % gridCols;
        const row = Math.floor(feedIndex / gridCols);
        const left = config.outerGridPadding + col * (config.scriptCardWidth + config.scriptCardColGap);
        const top = gridTop + row * (config.scriptCardHeight + config.scriptCardRowGap);
        rectByScriptId.set(entry.scriptId, {
            scriptId: entry.scriptId,
            fileName: entry.fileName,
            feedIndex,
            col,
            row,
            left,
            top,
            width: config.scriptCardWidth,
            height: config.scriptCardHeight,
            centerX: left + config.scriptCardWidth / 2,
            centerY: top + config.scriptCardHeight / 2,
        });
    });

    const usedRows = entries.length === 0 ? 0 : Math.ceil(entries.length / gridCols);
    const usedCols = entries.length === 0 ? 0 : Math.min(entries.length, gridCols);
    const gridCanvasWidth = usedCols === 0
        ? 2 * config.outerGridPadding
        : 2 * config.outerGridPadding + usedCols * config.scriptCardWidth + (usedCols - 1) * config.scriptCardColGap;
    const canvasHeight = usedRows === 0
        ? 2 * config.outerGridPadding + bandHeight
        : gridTop + usedRows * config.scriptCardHeight + (usedRows - 1) * config.scriptCardRowGap + config.outerGridPadding;

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
    for (const dep of dependencies.intra) {
        const from = rectByScriptId.get(dep.to); // source (referenced, earlier)
        const to = rectByScriptId.get(dep.from); // dependent (referencing, later)
        if (!from || !to) continue;
        const edgeType = selectEdgeType(from.centerX, from.centerY, to.centerX, to.centerY, config.scriptCardWidth, config.scriptCardHeight);
        prepared.push({
            dep,
            from,
            to,
            edgeType,
            fromPort: PORTS_FROM[edgeType] as NodePort,
            toPort: PORTS_TO[edgeType] as NodePort,
        });
    }

    // Second pass: render each edge's path and accumulate per-card port bitmasks.
    // Every edge attaches at the center of its port (offset 0), so all edges sharing
    // a port on a card converge to the exact same point — incoming and outgoing alike.
    const portsByScriptId = new Map<number, number>();
    const addPort = (scriptId: number, port: NodePort) => {
        portsByScriptId.set(scriptId, (portsByScriptId.get(scriptId) ?? 0) | port);
    };
    const builder = new PathBuilder();
    const edges: OverviewEdge[] = [];
    for (const pe of prepared) {
        buildEdgePathBetweenRectangles(
            builder,
            pe.edgeType,
            pe.from.centerX,
            pe.from.centerY,
            pe.to.centerX,
            pe.to.centerY,
            config.scriptCardWidth,
            config.scriptCardHeight,
            config.scriptCardWidth,
            config.scriptCardHeight,
            config.edgeCornerRadius,
            0,
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

    // Page-reference bar. Order the placeholder cards left-to-right by the mean column of the grid
    // cards that reference them, so edges rise roughly straight up and cross as little as possible.
    // Ties (and refs from cards not yet placed) fall back to page name for a stable order.
    const refsByPage = new Map<string, { count: number; colSum: number; colN: number }>();
    for (const dep of dependencies.crossPage) {
        const rect = rectByScriptId.get(dep.from);
        const agg = refsByPage.get(dep.targetPageName) ?? { count: 0, colSum: 0, colN: 0 };
        agg.count += 1;
        if (rect) {
            agg.colSum += rect.col;
            agg.colN += 1;
        }
        refsByPage.set(dep.targetPageName, agg);
    }
    const orderedPages = pageNames.slice().sort((a, b) => {
        const aa = refsByPage.get(a)!;
        const bb = refsByPage.get(b)!;
        const aMean = aa.colN > 0 ? aa.colSum / aa.colN : Number.POSITIVE_INFINITY;
        const bMean = bb.colN > 0 ? bb.colSum / bb.colN : Number.POSITIVE_INFINITY;
        if (aMean !== bMean) return aMean - bMean;
        return a < b ? -1 : a > b ? 1 : 0;
    });

    // Lay the page cards out left-to-right, top-to-bottom in a wrapping grid, mirroring the entry
    // grid but with the narrower page-card width. Left-aligned at the padding, not centered.
    const pageRefRects: PageRefRect[] = [];
    const rectByPageName = new Map<string, PageRefRect>();
    orderedPages.forEach((pageName, i) => {
        const col = i % pageRefCols;
        const row = Math.floor(i / pageRefCols);
        const left = config.outerGridPadding + col * (config.pageCardWidth + config.pageCardGap);
        const top = config.outerGridPadding + row * (config.pageCardHeight + config.pageRowGap);
        const rect: PageRefRect = {
            pageName,
            refCount: refsByPage.get(pageName)!.count,
            left,
            top,
            width: config.pageCardWidth,
            height: config.pageCardHeight,
            centerX: left + config.pageCardWidth / 2,
            centerY: top + config.pageCardHeight / 2,
        };
        pageRefRects.push(rect);
        rectByPageName.set(pageName, rect);
    });
    const usedPageCols = orderedPages.length === 0 ? 0 : Math.min(orderedPages.length, pageRefCols);
    const barCanvasWidth = usedPageCols === 0
        ? 0
        : 2 * config.outerGridPadding + usedPageCols * config.pageCardWidth + (usedPageCols - 1) * config.pageCardGap;

    // Page-reference edges: page card (source, above) → referencing grid card (dependent, below).
    // Same geometry machinery as intra-page edges; the page card sits above so the natural edge
    // type descends into the grid. Fan out parallel edges leaving one page card on the same port.
    interface PreparedPageEdge {
        dep: (typeof dependencies.crossPage)[number];
        from: PageRefRect;
        to: OverviewRect;
        edgeType: EdgeType;
        fromPort: NodePort;
        toPort: NodePort;
    }
    const preparedPage: PreparedPageEdge[] = [];
    for (const dep of dependencies.crossPage) {
        const from = rectByPageName.get(dep.targetPageName);
        const to = rectByScriptId.get(dep.from);
        if (!from || !to) continue;
        const edgeType = selectEdgeType(from.centerX, from.centerY, to.centerX, to.centerY, config.pageCardWidth, config.pageCardHeight);
        preparedPage.push({
            dep,
            from,
            to,
            edgeType,
            fromPort: PORTS_FROM[edgeType] as NodePort,
            toPort: PORTS_TO[edgeType] as NodePort,
        });
    }
    const portsByPageName = new Map<string, number>();
    const pageRefEdges: PageRefEdge[] = [];
    for (const pe of preparedPage) {
        buildEdgePathBetweenRectangles(
            builder,
            pe.edgeType,
            pe.from.centerX,
            pe.from.centerY,
            pe.to.centerX,
            pe.to.centerY,
            config.pageCardWidth,
            config.pageCardHeight,
            config.scriptCardWidth,
            config.scriptCardHeight,
            config.edgeCornerRadius,
            0,
        );
        portsByPageName.set(pe.from.pageName, (portsByPageName.get(pe.from.pageName) ?? 0) | pe.fromPort);
        addPort(pe.to.scriptId, pe.toPort);
        pageRefEdges.push({
            fromPageName: pe.from.pageName,
            toScriptId: pe.to.scriptId,
            fromPort: pe.fromPort,
            toPort: pe.toPort,
            path: builder.render(),
            focused: focusedScriptId != null && pe.to.scriptId === focusedScriptId,
        });
    }

    const canvasWidth = Math.max(gridCanvasWidth, barCanvasWidth);

    return {
        config,
        rectByScriptId,
        portsByScriptId,
        edges,
        pageRefRects,
        pageRefEdges,
        portsByPageName,
        canvasWidth,
        canvasHeight,
        gridCols,
    };
}
