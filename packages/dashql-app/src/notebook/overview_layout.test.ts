import { describe, it, expect } from 'vitest';

import { NodePort } from '../utils/graph_edges.js';
import { NotebookPageScript } from './notebook_types.js';
import { PageDependencies, PageDependency, PageReferenceDependency } from './overview_dependencies.js';
import { DEFAULT_OVERVIEW_LAYOUT, OverviewLayoutConfig, computeGridCols, layoutOverview } from './overview_layout.js';

function entry(scriptId: number, fileName: string): NotebookPageScript {
    return { scriptId, fileName };
}

/// Bundle intra/cross-page dependency lists into the PageDependencies shape layoutOverview expects.
function deps(intra: PageDependency[] = [], crossPage: PageReferenceDependency[] = []): PageDependencies {
    return { intra, crossPage };
}

// Small deterministic config so grid math is easy to reason about in assertions.
const CONFIG: OverviewLayoutConfig = {
    scriptCardWidth: 100,
    scriptCardHeight: 50,
    scriptCardColGap: 20,
    scriptCardRowGap: 20,
    outerGridPadding: 10,
    edgeCornerRadius: 4,
    pageCardWidth: 80,
    pageCardHeight: 30,
    pageCardGap: 20,
    pageRowGap: 20,
    pageBarGap: 40,
};

// Width that fits exactly three columns: 2*10 + 3*100 + 2*20 = 360.
const WIDTH_3_COLS = 360;

describe('computeGridCols', () => {
    it('wraps at the number of columns that fit the width', () => {
        expect(computeGridCols(WIDTH_3_COLS, CONFIG)).toBe(3);
        // One pixel short of a 4th column still yields 3.
        expect(computeGridCols(WIDTH_3_COLS + 119, CONFIG)).toBe(3);
        // Exactly enough for a 4th column.
        expect(computeGridCols(WIDTH_3_COLS + 120, CONFIG)).toBe(4);
    });

    it('never returns fewer than one column', () => {
        expect(computeGridCols(0, CONFIG)).toBe(1);
        expect(computeGridCols(-500, CONFIG)).toBe(1);
    });
});

describe('layoutOverview grid placement', () => {
    const entries = [
        entry(1, '1_a.sql'),
        entry(2, '2_b.sql'),
        entry(3, '3_c.sql'),
        entry(4, '4_d.sql'),
    ];

    it('places entries row-major in feed order, wrapping at gridCols', () => {
        const layout = layoutOverview(entries, deps(), WIDTH_3_COLS, null, CONFIG);
        expect(layout.gridCols).toBe(3);

        const r1 = layout.rectByScriptId.get(1)!;
        const r3 = layout.rectByScriptId.get(3)!;
        const r4 = layout.rectByScriptId.get(4)!;

        // First card: col 0, row 0.
        expect([r1.col, r1.row]).toEqual([0, 0]);
        expect([r1.left, r1.top]).toEqual([10, 10]);

        // Third card: col 2, row 0.
        expect([r3.col, r3.row]).toEqual([2, 0]);
        expect(r3.left).toBe(10 + 2 * (100 + 20));

        // Fourth card wraps to the next row.
        expect([r4.col, r4.row]).toEqual([0, 1]);
        expect(r4.top).toBe(10 + 1 * (50 + 20));
    });

    it('reflows responsively when the width changes', () => {
        const narrow = layoutOverview(entries, deps(), 130, null, CONFIG); // 1 column
        expect(narrow.gridCols).toBe(1);
        expect(narrow.rectByScriptId.get(4)!.row).toBe(3);
    });

    it('sizes the canvas from used columns and rows', () => {
        const layout = layoutOverview(entries, deps(), WIDTH_3_COLS, null, CONFIG);
        // 3 columns used, 2 rows used.
        expect(layout.canvasWidth).toBe(2 * 10 + 3 * 100 + 2 * 20);
        expect(layout.canvasHeight).toBe(2 * 10 + 2 * 50 + 1 * 20);
    });

    it('is deterministic (same input -> identical output)', () => {
        const a = layoutOverview(entries, deps(), WIDTH_3_COLS, null, CONFIG);
        const b = layoutOverview(entries, deps(), WIDTH_3_COLS, null, CONFIG);
        expect(JSON.stringify([...a.rectByScriptId])).toEqual(JSON.stringify([...b.rectByScriptId]));
        expect(a.edges).toEqual(b.edges);
    });
});

describe('layoutOverview edges', () => {
    const entries = [
        entry(1, '1_a.sql'),
        entry(2, '2_b.sql'),
        entry(3, '3_c.sql'),
    ];

    it('emits an edge between the dependent and its source with ports on both cards', () => {
        // Entry 2 (col 1) references entry 1 (col 0) — a right-neighbor edge.
        const intra: PageDependency[] = [{ from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 }];
        const layout = layoutOverview(entries, deps(intra), WIDTH_3_COLS, null, CONFIG);

        expect(layout.edges).toHaveLength(1);
        const edge = layout.edges[0];
        expect(edge.fromScriptId).toBe(1); // source (earlier)
        expect(edge.toScriptId).toBe(2); // dependent (later)
        // A left→right neighbor leaves the source's East side and enters the dependent's West side.
        expect(edge.fromPort).toBe(NodePort.East);
        expect(edge.toPort).toBe(NodePort.West);
        expect(edge.path.length).toBeGreaterThan(0);

        // Ports are accumulated on both cards.
        expect(layout.portsByScriptId.get(1)! & NodePort.East).toBeTruthy();
        expect(layout.portsByScriptId.get(2)! & NodePort.West).toBeTruthy();
    });

    it('attaches parallel edges leaving one card on the same port at the same point', () => {
        // Both entry 2 and entry 3 reference entry 1 — two edges leaving entry 1's East port.
        const intra: PageDependency[] = [
            { from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 },
            { from: 3, to: 1, fromFeedIndex: 2, toFeedIndex: 0 },
        ];
        const layout = layoutOverview(entries, deps(intra), WIDTH_3_COLS, null, CONFIG);
        expect(layout.edges).toHaveLength(2);
        // Both leave entry 1's East port, so both edges start at the exact same attachment
        // point (the port center, no fan-out offset). The `M x y` start command is shared.
        const start = (p: string) => p.slice(0, p.indexOf('L'));
        expect(start(layout.edges[0].path)).toEqual(start(layout.edges[1].path));
        // They still end at different cards, so the full paths differ.
        expect(layout.edges[0].path).not.toEqual(layout.edges[1].path);
    });

    it('marks edges touching the focused card', () => {
        const intra: PageDependency[] = [{ from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 }];
        const focused = layoutOverview(entries, deps(intra), WIDTH_3_COLS, /* focusedScriptId */ 1, CONFIG);
        expect(focused.edges[0].focused).toBe(true);

        const unfocused = layoutOverview(entries, deps(intra), WIDTH_3_COLS, /* focusedScriptId */ 3, CONFIG);
        expect(unfocused.edges[0].focused).toBe(false);
    });

    it('drops edges whose endpoints are not placed', () => {
        const intra: PageDependency[] = [{ from: 99, to: 1, fromFeedIndex: 5, toFeedIndex: 0 }];
        const layout = layoutOverview(entries, deps(intra), WIDTH_3_COLS, null, CONFIG);
        expect(layout.edges).toHaveLength(0);
    });
});

describe('layoutOverview page-reference bar', () => {
    const entries = [
        entry(1, '1_a.sql'),
        entry(2, '2_b.sql'),
        entry(3, '3_c.sql'),
    ];

    it('places one placeholder card per referenced page and drops the grid below the band', () => {
        const crossPage: PageReferenceDependency[] = [
            { from: 2, fromFeedIndex: 1, targetPageName: 'sales' },
            { from: 3, fromFeedIndex: 2, targetPageName: 'sales' },
            { from: 1, fromFeedIndex: 0, targetPageName: 'catalog' },
        ];
        const layout = layoutOverview(entries, deps([], crossPage), WIDTH_3_COLS, null, CONFIG);

        // One card per distinct page, with the correct fan-in counts.
        expect(layout.pageRefRects.map(r => r.pageName).sort()).toEqual(['catalog', 'sales']);
        expect(layout.pageRefRects.find(r => r.pageName === 'sales')!.refCount).toBe(2);
        expect(layout.pageRefRects.find(r => r.pageName === 'catalog')!.refCount).toBe(1);

        // Bar sits at the top padding; the grid is pushed down by the band (card height + bar gap).
        expect(layout.pageRefRects.every(r => r.top === CONFIG.outerGridPadding)).toBe(true);
        const band = CONFIG.pageCardHeight + CONFIG.pageBarGap;
        expect(layout.rectByScriptId.get(1)!.top).toBe(CONFIG.outerGridPadding + band);

        // One edge per cross-page reference, each landing on its page card.
        expect(layout.pageRefEdges).toHaveLength(3);
        expect(layout.portsByPageName.get('sales')).toBeTruthy();
    });

    it('adds no band when there are no cross-page references', () => {
        const layout = layoutOverview(entries, deps(), WIDTH_3_COLS, null, CONFIG);
        expect(layout.pageRefRects).toHaveLength(0);
        expect(layout.pageRefEdges).toHaveLength(0);
        // Grid starts at the plain top padding — unchanged from before the bar existed.
        expect(layout.rectByScriptId.get(1)!.top).toBe(CONFIG.outerGridPadding);
    });
});

describe('layoutOverview defaults', () => {
    it('handles an empty page', () => {
        const layout = layoutOverview([], deps(), 800, null, DEFAULT_OVERVIEW_LAYOUT);
        expect(layout.rectByScriptId.size).toBe(0);
        expect(layout.edges).toHaveLength(0);
        expect(layout.canvasWidth).toBe(2 * DEFAULT_OVERVIEW_LAYOUT.outerGridPadding);
    });
});
