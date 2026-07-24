import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { getSelectedPage, getSelectedPageEntries, getSortedFolderNames, NotebookState, SELECT_ENTRY, SELECT_PAGE } from '../../notebook/notebook_state.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { computePageDependencies } from '../../notebook/overview_dependencies.js';
import { DEFAULT_OVERVIEW_LAYOUT, layoutOverview } from '../../notebook/overview_layout.js';
import { normalizePageName } from '../../notebook/notebook_types.js';
import { observeSize } from '../foundations/size_observer.js';
import { EdgeLayer } from './edge_layer.js';
import { NodeLayer } from './node_layer.js';
import { OverviewCard } from './overview_card.js';
import { PageRefCard } from './page_ref_card.js';
import { TabKey as DetailsTabKey } from './notebook_script_details.js';

export interface NotebookPageOverviewProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    showDetails: (initialTab?: DetailsTabKey) => void;
}

/// Horizontal space (px) reserved on each side of the grid for the feed view toggle that floats in
/// the top-left corner. The board is centered and its width capped so the leftmost column never
/// slides underneath the toggle. Symmetric so centering keeps both edges clear. Covers the toggle
/// inset (16px) plus the small segmented control (~66px) with a little breathing room.
const VIEW_TOGGLE_CLEARANCE = 96;

/// Zoomed-out map of a single notebook page: each feed entry is a fixed-size card
/// laid out in a deterministic row-major grid, with dependency edges drawn
/// between cards. Reuses the revived catalog NodeLayer/EdgeLayer + ports. All
/// geometry is derived at runtime — no persisted layout metadata.
export function NotebookPageOverview(props: NotebookPageOverviewProps): React.ReactElement {
    const { notebook, modifyNotebook } = props;
    const sessionId = notebook.sessionId;
    const config = DEFAULT_OVERVIEW_LAYOUT;

    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    // Reserve clearance on both sides for the floating view toggle so the centered grid never slides
    // underneath it. The grid wraps within (and is later capped to) this reduced width.
    const availableWidth = Math.max(0, (containerSize?.width ?? 0) - 2 * VIEW_TOGGLE_CLEARANCE);

    const page = getSelectedPage(notebook);
    const entries = getSelectedPageEntries(notebook);
    const focusedFileName = notebook.notebookUserFocus.fileName;

    // Resolve the focused entry's scriptId so focused edges/ports render on top.
    const focusedScriptId = React.useMemo(() => {
        if (!focusedFileName || !page) return null;
        return page.scripts[focusedFileName]?.scriptId ?? null;
    }, [focusedFileName, page]);

    // Dependencies are derived from analyzer output; recompute when the entries or
    // any of their analyzed buffers change. Keyed on the scripts map so a
    // re-analysis (fresh buffers) refreshes the edges.
    const dependencies = React.useMemo(() => {
        if (!page) return { intra: [], crossPage: [] };
        return computePageDependencies(entries, notebook.scripts, page);
    }, [entries, notebook.scripts, page]);

    const layout = React.useMemo(() => {
        return layoutOverview(entries, dependencies, availableWidth, focusedScriptId, config);
    }, [entries, dependencies, availableWidth, focusedScriptId, config]);

    const handleFocus = React.useCallback((fileName: string) => {
        modifyNotebook({ type: SELECT_ENTRY, value: fileName });
    }, [modifyNotebook]);
    const handleExpand = React.useCallback((fileName: string) => {
        modifyNotebook({ type: SELECT_ENTRY, value: fileName });
        props.showDetails();
    }, [modifyNotebook, props.showDetails]);
    // Placeholder page cards carry the *clean* page name; resolve it to the owning folder (the tab
    // key) at click time so no scriptId→folder index is needed. SELECT_PAGE no-ops on a miss.
    const handleSelectPage = React.useCallback((pageName: string) => {
        const folderName = getSortedFolderNames(notebook.notebookPages).find(f => normalizePageName(f) === pageName);
        if (folderName) modifyNotebook({ type: SELECT_PAGE, value: folderName });
    }, [modifyNotebook, notebook.notebookPages]);

    // Ports on a grid card that a *focused* edge attaches to, so those exact ports render in the
    // focused style — on *both* ends of a focused edge, not just the focused card. Covers intra-page
    // edges (both endpoints) and page-reference edges (the grid card they land on).
    const focusedPortsByScriptId = React.useMemo(() => {
        const focused = new Map<number, number>();
        const add = (scriptId: number, port: number) =>
            focused.set(scriptId, (focused.get(scriptId) ?? 0) | port);
        for (const edge of layout.edges) {
            if (!edge.focused) continue;
            add(edge.fromScriptId, edge.fromPort);
            add(edge.toScriptId, edge.toPort);
        }
        for (const edge of layout.pageRefEdges) {
            if (!edge.focused) continue;
            add(edge.toScriptId, edge.toPort);
        }
        return focused;
    }, [layout.edges, layout.pageRefEdges]);

    // Cards, sorted by feed order for a stable DOM order.
    const cards = React.useMemo(() => {
        return entries.map(entry => {
            const rect = layout.rectByScriptId.get(entry.scriptId);
            if (!rect) return null;
            return (
                <OverviewCard
                    key={entry.scriptId}
                    sessionId={sessionId}
                    rect={rect}
                    scriptData={notebook.scripts[entry.scriptId]}
                    ports={layout.portsByScriptId.get(entry.scriptId) ?? 0}
                    focusedPorts={focusedPortsByScriptId.get(entry.scriptId) ?? 0}
                    onFocus={handleFocus}
                    onExpand={handleExpand}
                />
            );
        });
    }, [entries, layout, notebook.scripts, sessionId, focusedPortsByScriptId, handleFocus, handleExpand]);

    // Ports on a page-reference card that a *focused* edge attaches to, so they render in
    // the focused style (matching the highlighted edge + the grid card's port on the other end).
    const focusedPortsByPageName = React.useMemo(() => {
        const focused = new Map<string, number>();
        for (const edge of layout.pageRefEdges) {
            if (!edge.focused) continue;
            focused.set(edge.fromPageName, (focused.get(edge.fromPageName) ?? 0) | edge.fromPort);
        }
        return focused;
    }, [layout.pageRefEdges]);

    // Placeholder cards for referenced other pages, in the bar above the grid.
    const pageRefCards = React.useMemo(() => {
        return layout.pageRefRects.map(rect => (
            <PageRefCard
                key={`page:${rect.pageName}`}
                rect={rect}
                ports={layout.portsByPageName.get(rect.pageName) ?? 0}
                focusedPorts={focusedPortsByPageName.get(rect.pageName) ?? 0}
                onSelect={handleSelectPage}
            />
        ));
    }, [layout.pageRefRects, layout.portsByPageName, focusedPortsByPageName, handleSelectPage]);

    // Edges: normal first, focused last so they render on top. Page-reference edges use a distinct
    // "leaves this page" style and render beneath the intra-page edges.
    const edgePaths = React.useMemo(() => {
        const normal: React.ReactElement[] = [];
        const focused: React.ReactElement[] = [];
        layout.pageRefEdges.forEach((edge, i) => {
            const el = (
                <path
                    key={`pageedge:${edge.fromPageName}-${edge.toScriptId}-${i}`}
                    className={edge.focused ? styles.page_ref_edge_path_focused : styles.page_ref_edge_path}
                    d={edge.path}
                    data-edge={`${edge.fromPageName}-${edge.toScriptId}`}
                />
            );
            (edge.focused ? focused : normal).push(el);
        });
        layout.edges.forEach((edge, i) => {
            const el = (
                <path
                    key={`${edge.fromScriptId}-${edge.toScriptId}-${i}`}
                    className={edge.focused ? styles.edge_path_focused : styles.edge_path}
                    d={edge.path}
                    data-edge={`${edge.fromScriptId}-${edge.toScriptId}`}
                />
            );
            (edge.focused ? focused : normal).push(el);
        });
        return [...normal, ...focused];
    }, [layout.edges, layout.pageRefEdges]);

    return (
        <div ref={containerRef} className={styles.board_container}>
            <div className={styles.board} style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
                <EdgeLayer
                    className={styles.edge_layer}
                    width={layout.canvasWidth}
                    height={layout.canvasHeight}
                    paddingTop={0}
                    paddingRight={0}
                    paddingBottom={0}
                    paddingLeft={0}
                    paths={edgePaths}
                />
                <NodeLayer
                    className={styles.node_layer}
                    width={layout.canvasWidth}
                    height={layout.canvasHeight}
                    paddingTop={0}
                    paddingRight={0}
                    paddingBottom={0}
                    paddingLeft={0}
                    nodes={<>{pageRefCards}{cards}</>}
                />
            </div>
        </div>
    );
}
