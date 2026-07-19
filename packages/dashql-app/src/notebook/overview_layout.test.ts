import { describe, it, expect } from 'vitest';

import { NodePort } from '../utils/graph_edges.js';
import { NotebookPageScript } from './notebook_types.js';
import { PageDependency } from './overview_dependencies.js';
import { DEFAULT_OVERVIEW_LAYOUT, OverviewLayoutConfig, computeGridCols, layoutOverview } from './overview_layout.js';

function entry(scriptId: number, fileName: string): NotebookPageScript {
    return { scriptId, fileName };
}

// Small deterministic config so grid math is easy to reason about in assertions.
const CONFIG: OverviewLayoutConfig = {
    cardWidth: 100,
    cardHeight: 50,
    colGap: 20,
    rowGap: 20,
    padding: 10,
    cornerRadius: 4,
    offsetStep: 8,
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
        const layout = layoutOverview(entries, [], WIDTH_3_COLS, null, CONFIG);
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
        const narrow = layoutOverview(entries, [], 130, null, CONFIG); // 1 column
        expect(narrow.gridCols).toBe(1);
        expect(narrow.rectByScriptId.get(4)!.row).toBe(3);
    });

    it('sizes the canvas from used columns and rows', () => {
        const layout = layoutOverview(entries, [], WIDTH_3_COLS, null, CONFIG);
        // 3 columns used, 2 rows used.
        expect(layout.canvasWidth).toBe(2 * 10 + 3 * 100 + 2 * 20);
        expect(layout.canvasHeight).toBe(2 * 10 + 2 * 50 + 1 * 20);
    });

    it('is deterministic (same input -> identical output)', () => {
        const a = layoutOverview(entries, [], WIDTH_3_COLS, null, CONFIG);
        const b = layoutOverview(entries, [], WIDTH_3_COLS, null, CONFIG);
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
        const deps: PageDependency[] = [{ from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 }];
        const layout = layoutOverview(entries, deps, WIDTH_3_COLS, null, CONFIG);

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

    it('separates parallel edges leaving one card on the same port with distinct offsets', () => {
        // Both entry 2 and entry 3 reference entry 1 — two edges leaving entry 1's East port.
        const deps: PageDependency[] = [
            { from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 },
            { from: 3, to: 1, fromFeedIndex: 2, toFeedIndex: 0 },
        ];
        const layout = layoutOverview(entries, deps, WIDTH_3_COLS, null, CONFIG);
        expect(layout.edges).toHaveLength(2);
        // Distinct offsets produce distinct path strings for the two parallel edges.
        expect(layout.edges[0].path).not.toEqual(layout.edges[1].path);
    });

    it('marks edges touching the focused card', () => {
        const deps: PageDependency[] = [{ from: 2, to: 1, fromFeedIndex: 1, toFeedIndex: 0 }];
        const focused = layoutOverview(entries, deps, WIDTH_3_COLS, /* focusedScriptId */ 1, CONFIG);
        expect(focused.edges[0].focused).toBe(true);

        const unfocused = layoutOverview(entries, deps, WIDTH_3_COLS, /* focusedScriptId */ 3, CONFIG);
        expect(unfocused.edges[0].focused).toBe(false);
    });

    it('drops edges whose endpoints are not placed', () => {
        const deps: PageDependency[] = [{ from: 99, to: 1, fromFeedIndex: 5, toFeedIndex: 0 }];
        const layout = layoutOverview(entries, deps, WIDTH_3_COLS, null, CONFIG);
        expect(layout.edges).toHaveLength(0);
    });
});

describe('layoutOverview defaults', () => {
    it('handles an empty page', () => {
        const layout = layoutOverview([], [], 800, null, DEFAULT_OVERVIEW_LAYOUT);
        expect(layout.rectByScriptId.size).toBe(0);
        expect(layout.edges).toHaveLength(0);
        expect(layout.canvasWidth).toBe(2 * DEFAULT_OVERVIEW_LAYOUT.padding);
    });
});
