import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import * as styles from './catalog_viewer.module.css'

import { CatalogRenderingSettings, CatalogViewModel } from './catalog_view_model.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus } from '../../connection/catalog_update_state.js';
import { EdgeLayer } from './edge_layer.js';
import { NodeLayer } from './node_layer.js';
import { observeSize } from '../foundations/size_observer.js';
import { renderCatalog, RenderingOutput } from './catalog_renderer.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useThrottledMemo } from '../../utils/throttle.js';
import { useWorkbookState } from '../../workbook/workbook_state_registry.js';
import { UserFocus } from '../../workbook/focus.js';

export const PADDING_LEFT = 20;
export const PADDING_TOP = 8;
export const PADDING_BOTTOM = 16;
export const PADDING_RIGHT = 20;
export const RENDERING_SETTINGS: CatalogRenderingSettings = {
    virtual: {
        prerenderSize: 200,
        stepSize: 1,
    },
    levels: {
        databases: {
            nodeWidth: 160,
            nodeHeight: 24,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 24,
            childOffsetX: 24,
        },
        schemas: {
            nodeWidth: 160,
            nodeHeight: 24,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 24,
            childOffsetX: 24,
        },
        tables: {
            nodeWidth: 160,
            nodeHeight: 24,
            maxUnpinnedChildren: 5,
            levelGap: 8,
            rowGap: 8,
            childOffsetX: 24,
        },
        columns: {
            nodeWidth: 160,
            nodeHeight: 24,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 8,
            childOffsetX: 24,
        },
    },
    details: {
        nodeWidth: 160,
        offsetY: 8,
    }
};

interface Props {
    workbookId: number;
}

export function CatalogViewer(props: Props) {
    const [workbook, _modifyWorkbook] = useWorkbookState(props.workbookId ?? null);
    const [conn, _connDispatch] = useConnectionState(workbook?.connectionId ?? null);
    const workbookEntry = workbook?.workbookEntries[workbook.selectedWorkbookEntry];
    const script = workbookEntry ? workbook.scripts[workbookEntry.scriptId] : null;

    // Watch the container size
    const containerElement = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerElement);
    const boardElement = React.useRef(null);

    // Maintain a catalog snapshot of the workbook
    const [viewModel, setViewModel] = React.useState<CatalogViewModel | null>(null);
    const [viewModelVersion, setViewModelVersion] = React.useState<number>(0);
    React.useEffect(() => {
        const snapshot = workbook?.connectionCatalog.createSnapshot() ?? null;
        const registry = workbook?.scriptRegistry ?? null;
        if (snapshot && registry) {
            const state = new CatalogViewModel(snapshot, registry, RENDERING_SETTINGS);
            setViewModel(state);
        }
    }, [workbook?.connectionCatalog.snapshot]);
    const viewModelHeight = (viewModel?.totalHeight ?? 0) + PADDING_BOTTOM + PADDING_TOP;

    // Triggered whenever the catalog view model or the script buffers change
    const previousScript = React.useRef<dashql.DashQLScript | null>(null);
    React.useEffect(() => {
        if (!script) {
            return;
        }

        // Script changed completey?
        // Then reset also the column rendering
        if (previousScript.current !== script.script) {
            previousScript.current = script.script;
            viewModel?.unpinFocusedByUser();
        }
        // Pin new script refs and restore user focus
        if (viewModel != null && script.processed.analyzed != null) {
            // Pin script refs
            const analyzed = script.processed.analyzed.read();
            viewModel.pinScriptRefs(analyzed);
            // Restore the user focus.
            // We need to do this in the same useEffect if we want to get rid of flickering
            // XXX We'll double-pin focused now
            if (workbook?.userFocus) {
                viewModel.pinFocusedByUser(workbook.userFocus);
            }
            setViewModelVersion(v => v + 1);
        }

    }, [viewModel, script?.processed]);

    // React to user focus changes
    const previousFocus = React.useRef<UserFocus | null>(null);
    React.useEffect(() => {
        const prev = previousFocus.current;
        const next = workbook?.userFocus ?? null;
        previousFocus.current = next;

        // Focus changed?
        if (viewModel != null && prev !== next) {
            // Unpin focused
            if (next == null) {
                viewModel.unpinFocusedByUser();
            } else {
                // Pin focused elements
                viewModel.pinFocusedByUser(next);

                // Scroll to first focused entry
                let [scrollToFocus, found] = viewModel.getOffsetOfFirstFocused();
                if (found && containerElement.current != null && containerSize != null && boardElement.current != null) {
                    const containerDiv = containerElement.current as HTMLDivElement;
                    const boardDiv = boardElement.current as HTMLDivElement;
                    const clientVerticalCenter = containerSize.height / 2;
                    scrollToFocus = Math.max(scrollToFocus + PADDING_TOP, clientVerticalCenter) - clientVerticalCenter;

                    // XXX Are browsers doing the right thing here?
                    //     Manual tests indicate that this is working...
                    //     We manually bump the minimum height to make sure there's enough room for scrollTop.
                    const newViewModelHeight = (viewModel?.totalHeight ?? 0) + PADDING_TOP + PADDING_BOTTOM;
                    boardDiv.style.minHeight = `${newViewModelHeight}px`;
                    containerDiv.scrollTop = scrollToFocus;
                }
            }
            // This will trigger a rerender
            setViewModelVersion(v => v + 1);
        }
    }, [viewModel, workbook?.userFocus]);

    // Subscribe to scroll events
    interface Range { top: number; height: number; };
    interface RenderingWindow { scroll: Range; virtual: Range; };
    const [scrollTopRaw, setScrollTop] = React.useState<number | null>(null);
    const handleScroll = (e: React.UIEvent<HTMLDivElement, UIEvent>) => {
        const scrollTop = (e.target as HTMLDivElement).scrollTop;
        setScrollTop(Math.max(scrollTop, PADDING_TOP) - PADDING_BOTTOM);
    };
    const scrollTop = useThrottledMemo(scrollTopRaw, [scrollTopRaw], 10);

    // Derive a virtual window from the scroll position and container size
    const renderingWindow = React.useMemo<RenderingWindow | null>(() => {
        // Skip if we don't know the container size yet
        if (!containerSize || !viewModel) {
            return null;
        }

        // Did the user scroll?
        if (scrollTop) {
            let lb = Math.floor((scrollTop - RENDERING_SETTINGS.virtual.prerenderSize) / RENDERING_SETTINGS.virtual.stepSize) * RENDERING_SETTINGS.virtual.stepSize;
            let ub = Math.ceil((scrollTop + containerSize.height + RENDERING_SETTINGS.virtual.prerenderSize) / RENDERING_SETTINGS.virtual.stepSize) * RENDERING_SETTINGS.virtual.stepSize;
            lb = Math.max(lb, 0);
            ub = Math.min(ub, viewModelHeight);
            return {
                scroll: {
                    top: scrollTop,
                    // Make sure we respect the top padding when computing the scroll window.
                    // When we're on the "first page", we have to subtract the top padding from the container height.
                    height: Math.max(containerSize.height - PADDING_TOP + Math.min(scrollTop, PADDING_TOP), 0)
                },
                virtual: {
                    top: lb,
                    height: ub - lb
                }
            };
        } else {
            // The user didn't scoll, just render the container
            let ub = Math.ceil((containerSize.height + RENDERING_SETTINGS.virtual.prerenderSize) / RENDERING_SETTINGS.virtual.stepSize) * RENDERING_SETTINGS.virtual.stepSize;
            ub = Math.min(ub, viewModelHeight);
            return {
                scroll: {
                    top: 0,
                    height: Math.max(containerSize.height, PADDING_TOP) - PADDING_TOP
                },
                virtual: {
                    top: 0,
                    height: ub
                }
            };
        }
    }, [viewModelVersion, scrollTop, containerSize]);

    // Memo must depend on scroll window and window size
    const renderedOutput = React.useMemo<RenderingOutput>((): RenderingOutput => {
        // No state or measured container size?
        if (!viewModel || !renderingWindow) {
            return {
                nodes: [],
                edges: [],
                edgesFocused: [],
            };
        }
        // Update the virtual window
        viewModel.updateWindow(
            renderingWindow.scroll.top,
            renderingWindow.scroll.top + renderingWindow.scroll.height,
            renderingWindow.virtual.top,
            renderingWindow.virtual.top + renderingWindow.virtual.height
        );
        // Render the catalog
        const output = renderCatalog(viewModel);
        return output;

    }, [viewModelVersion, renderingWindow]);


    // Should we always expand the info overlay?
    const widthWhenExpanded = (viewModel?.totalWidth ?? 0) + PADDING_LEFT + PADDING_RIGHT;

    let layerWidth = viewModel?.totalWidth ?? 0;
    let layerHeight = viewModel?.totalHeight ?? 0;
    return (
        <div
            className={styles.root}
            style={{
                width: widthWhenExpanded
            }}
        >
            <div
                className={styles.board_container}
                ref={containerElement}
                onScroll={handleScroll}
            >
                <div
                    className={styles.board}
                    ref={boardElement}
                    style={{
                        minHeight: viewModelHeight
                    }}
                >
                    <EdgeLayer
                        className={styles.edge_layer}
                        width={layerWidth}
                        height={layerHeight}
                        paddingTop={PADDING_TOP}
                        paddingRight={PADDING_RIGHT}
                        paddingLeft={PADDING_LEFT}
                        paddingBottom={PADDING_BOTTOM}
                        paths={renderedOutput.edges ?? []}
                    />
                    <EdgeLayer
                        className={styles.edge_layer_focused}
                        width={layerWidth}
                        height={layerHeight}
                        paddingTop={PADDING_TOP}
                        paddingRight={PADDING_RIGHT}
                        paddingLeft={PADDING_LEFT}
                        paddingBottom={PADDING_BOTTOM}
                        paths={renderedOutput.edgesFocused ?? []}
                    />
                    <NodeLayer
                        width={layerWidth}
                        height={layerHeight}
                        paddingTop={PADDING_TOP}
                        paddingRight={PADDING_RIGHT}
                        paddingLeft={PADDING_LEFT}
                        paddingBottom={PADDING_BOTTOM}
                        nodes={renderedOutput.nodes}
                    />
                </div>
            </div>
        </div>
    );
}
