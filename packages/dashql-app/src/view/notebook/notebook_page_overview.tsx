import * as React from 'react';
import * as styles from './notebook_page_overview.module.css';

import { getSelectedPage, getSelectedPageEntries, NotebookState, SELECT_ENTRY } from '../../notebook/notebook_state.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { computePageDependencies } from '../../notebook/overview_dependencies.js';
import { DEFAULT_OVERVIEW_LAYOUT, layoutOverview } from '../../notebook/overview_layout.js';
import { observeSize } from '../foundations/size_observer.js';
import { EdgeLayer } from './edge_layer.js';
import { NodeLayer } from './node_layer.js';
import { OverviewCard } from './overview_card.js';
import { TabKey as DetailsTabKey } from './notebook_script_details.js';

export interface NotebookPageOverviewProps {
    notebook: NotebookState;
    modifyNotebook: ModifyNotebook;
    showDetails: (initialTab?: DetailsTabKey) => void;
}

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
    const availableWidth = containerSize?.width ?? 0;

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
        if (!page) return [];
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
                    focused={entry.scriptId === focusedScriptId}
                    onFocus={handleFocus}
                    onExpand={handleExpand}
                />
            );
        });
    }, [entries, layout, notebook.scripts, sessionId, focusedScriptId, handleFocus, handleExpand]);

    // Edges: normal first, focused last so they render on top.
    const edgePaths = React.useMemo(() => {
        const normal: React.ReactElement[] = [];
        const focused: React.ReactElement[] = [];
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
    }, [layout.edges]);

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
                    nodes={cards}
                />
            </div>
        </div>
    );
}
