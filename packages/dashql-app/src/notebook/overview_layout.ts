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
    /// Width of a page-reference placeholder card in the top bar.
    pageCardWidth: number;
    /// Height of a page-reference placeholder card in the top bar.
    pageCardHeight: number;
    /// Horizontal gap between adjacent page-reference cards.
    pageCardGap: number;
    /// Vertical gap between the page-reference bar and the top of the grid.
    pageBarGap: number;
}

export const DEFAULT_OVERVIEW_LAYOUT: OverviewLayoutConfig = {
    cardWidth: 200,
    cardHeight: 132,
    colGap: 56,
    rowGap: 56,
    padding: 32,
    cornerRadius: 6,
    offsetStep: 10,
    pageCardWidth: 160,
    pageCardHeight: 56,
    pageCardGap: 40,
    pageBarGap: 72,
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
    dependencies: PageDependencies,
    availableWidth: number,
    focusedScriptId: number | null = null,
    config: OverviewLayoutConfig = DEFAULT_OVERVIEW_LAYOUT,
): OverviewLayout {
    const gridCols = computeGridCols(availableWidth, config);

    // Reserve a band above the grid for the page-reference bar when there are cross-page refs, so
    // the grid drops down to make room. Its height is fixed; the cards themselves are placed below.
    const pageNames = Array.from(new Set(dependencies.crossPage.map(d => d.targetPageName)));
    const bandHeight = pageNames.length > 0 ? config.pageCardHeight + config.pageBarGap : 0;
    const gridTop = config.padding + bandHeight;

    // Place each entry into the grid in feed order.
    const rectByScriptId = new Map<number, OverviewRect>();
    entries.forEach((entry, feedIndex) => {
        const col = feedIndex % gridCols;
        const row = Math.floor(feedIndex / gridCols);
        const left = config.padding + col * (config.cardWidth + config.colGap);
        const top = gridTop + row * (config.cardHeight + config.rowGap);
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
    const gridCanvasWidth = usedCols === 0
        ? 2 * config.padding
        : 2 * config.padding + usedCols * config.cardWidth + (usedCols - 1) * config.colGap;
    const canvasHeight = usedRows === 0
        ? 2 * config.padding + bandHeight
        : gridTop + usedRows * config.cardHeight + (usedRows - 1) * config.rowGap + config.padding;

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

    // Lay the bar out centered over the grid's used width.
    const barWidth = orderedPages.length === 0
        ? 0
        : orderedPages.length * config.pageCardWidth + (orderedPages.length - 1) * config.pageCardGap;
    const gridUsedWidth = gridCanvasWidth - 2 * config.padding;
    const barLeft = config.padding + Math.max(0, (gridUsedWidth - barWidth) / 2);
    const pageRefRects: PageRefRect[] = [];
    const rectByPageName = new Map<string, PageRefRect>();
    orderedPages.forEach((pageName, i) => {
        const left = barLeft + i * (config.pageCardWidth + config.pageCardGap);
        const top = config.padding;
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
    const pageGroups = new Map<string, PreparedPageEdge[]>();
    for (const pe of preparedPage) {
        const key = `${pe.from.pageName}:${pe.fromPort}`;
        const group = pageGroups.get(key);
        if (group) group.push(pe);
        else pageGroups.set(key, [pe]);
    }
    const offsetByPageEdge = new Map<PreparedPageEdge, number>();
    for (const group of pageGroups.values()) {
        group.sort((a, b) => a.dep.fromFeedIndex - b.dep.fromFeedIndex);
        const n = group.length;
        group.forEach((pe, i) => {
            offsetByPageEdge.set(pe, (i - (n - 1) / 2) * config.offsetStep);
        });
    }

    const portsByPageName = new Map<string, number>();
    const pageRefEdges: PageRefEdge[] = [];
    for (const pe of preparedPage) {
        const offset = offsetByPageEdge.get(pe) ?? 0;
        buildEdgePathBetweenRectangles(
            builder,
            pe.edgeType,
            pe.from.centerX,
            pe.from.centerY,
            pe.to.centerX,
            pe.to.centerY,
            config.pageCardWidth,
            config.pageCardHeight,
            config.cardWidth,
            config.cardHeight,
            config.cornerRadius,
            offset,
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

    const canvasWidth = Math.max(gridCanvasWidth, barLeft + barWidth + config.padding);

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
