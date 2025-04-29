import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import * as styles from './catalog_viewer.module.css'

import { renderCatalog, RenderingOutput, RenderingState } from './catalog_renderer.js';
import { observeSize } from '../foundations/size_observer.js';
import { EdgeLayer } from './edge_layer.js';
import { NodeLayer } from './node_layer.js';
import { useThrottledMemo } from '../../utils/throttle.js';
import { CatalogLevel, CatalogRenderingSettings, CatalogViewModel } from './catalog_view_model.js';
import { useWorkbookState } from '../../workbook/workbook_state_registry.js';

export const DEFAULT_RENDERING_SETTINGS: CatalogRenderingSettings = {
    virtual: {
        prerenderSize: 200,
        stepSize: 1,
    },
    levels: {
        databases: {
            nodeWidth: 160,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            rowGap: 24,
            columnGap: 48,
        },
        schemas: {
            nodeWidth: 160,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            rowGap: 24,
            columnGap: 48,
        },
        tables: {
            nodeWidth: 160,
            nodeHeight: 36,
            maxUnpinnedChildren: 5,
            rowGap: 8,
            columnGap: 48,
        },
        columns: {
            nodeWidth: 160,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            rowGap: 8,
            columnGap: 48,
        },
    }
};

interface Props {
    workbookId: number;
}

export function CatalogViewer(props: Props) {
    const [workbook, _modifyWorkbook] = useWorkbookState(props.workbookId ?? null);
    const workbookEntry = workbook?.workbookEntries[workbook.selectedWorkbookEntry];
    const script = workbookEntry ? workbook.scripts[workbookEntry.scriptKey] : null;

    // Watch the container size
    const containerElement = React.useRef(null);
    const containerSize = observeSize(containerElement);
    const boardElement = React.useRef(null);
    let paddingTop = 20;
    let paddingBottom = 20;
    const paddingRight = 20;
    const paddingLeft = 20;

    // Maintain a catalog snapshot of the workbook
    const [viewModel, setViewModel] = React.useState<CatalogViewModel | null>(null);
    const [viewModelVersion, setViewModelVersion] = React.useState<number>(0);
    React.useEffect(() => {
        const snapshot = workbook?.connectionCatalog.createSnapshot() ?? null;
        if (snapshot) {
            const state = new CatalogViewModel(snapshot, DEFAULT_RENDERING_SETTINGS);
            setViewModel(state);
        }
    }, [workbook?.connectionCatalog.snapshot]);

    // Render with or without columns?
    const [renderColumns, setRenderColumns] = React.useState<boolean>(true);
    // Flipping column rendering will change the view model height and then trigger a rerender
    const viewModelHeight = (renderColumns ? viewModel?.totalHeightWithColumns : viewModel?.totalHeightWithoutColumns) ?? 0;

    // Load script refs
    const previousScript = React.useRef<dashql.DashQLScript | null>(null);
    // Triggered whenever the catalog view model or the script buffers change
    React.useEffect(() => {
        if (!script) {
            return;
        }
        if (viewModel != null && script.processed.analyzed != null) {
            const analyzed = script.processed.analyzed.read();
            viewModel.pinScriptRefs(analyzed);
            setViewModelVersion(v => v + 1);
        }
        // Script changed completey?
        // Then reset also the column rendering
        if (previousScript.current !== script.script) {
            previousScript.current = script.script;
            viewModel?.unpinFocusedByUser();
            setRenderColumns(true);
        }

    }, [viewModel, script?.processed]);

    // React to user focus changes
    React.useEffect(() => {
        if (viewModel != null && workbook?.userFocus) {
            // Pin focused elements
            viewModel.pinFocusedByUser(workbook.userFocus);
            // Get the number of focused levels
            let newRenderColumns = true;
            if (viewModel.getFirstUnfocusedLevel() == CatalogLevel.Column) {
                newRenderColumns = false;
            }
            // Collapsing/expanding columns based on user-focus and jumping in the scroll container at the same time is racy
            if (newRenderColumns != renderColumns) {
                setRenderColumns(newRenderColumns);
            }

            // Scroll to first focused entry
            let [scrollToFocus, found] = viewModel.getOffsetOfFirstFocused(newRenderColumns);
            if (found && containerElement.current != null && containerSize != null && boardElement.current != null) {
                const containerDiv = containerElement.current as HTMLDivElement;
                const boardDiv = boardElement.current as HTMLDivElement;
                const clientVerticalCenter = containerSize.height / 2;
                scrollToFocus = Math.max(scrollToFocus, clientVerticalCenter) - clientVerticalCenter; // XXX Padding

                const newViewModelHeight = (newRenderColumns ? viewModel?.totalHeightWithColumns : viewModel?.totalHeightWithoutColumns) ?? 0;
                // XXX Are browsers doing the right thing here?
                //     Manual tests indicate that this is working...
                //     We manually bump the minimum height to make sure there's enough room for scrollTop.
                boardDiv.style.minHeight = `${newViewModelHeight}px`;
                containerDiv.scrollTop = scrollToFocus;
            }

            // This will trigger a rerender
            setViewModelVersion(v => v + 1);
        }
    }, [viewModel, workbook?.userFocus]);

    // Subscribe to scroll events
    interface Range {
        top: number;
        height: number;
    };
    interface RenderingWindow {
        scroll: Range;
        virtual: Range;
    };
    const [scrollTopRaw, setScrollTop] = React.useState<number | null>(null);
    const handleScroll = (e: React.UIEvent<HTMLDivElement, UIEvent>) => {
        const scrollTop = (e.target as HTMLDivElement).scrollTop;
        setScrollTop(Math.max(scrollTop, paddingTop) - paddingTop);
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
            let lb = Math.floor((scrollTop - DEFAULT_RENDERING_SETTINGS.virtual.prerenderSize) / DEFAULT_RENDERING_SETTINGS.virtual.stepSize) * DEFAULT_RENDERING_SETTINGS.virtual.stepSize;
            let ub = Math.ceil((scrollTop + containerSize.height + DEFAULT_RENDERING_SETTINGS.virtual.prerenderSize) / DEFAULT_RENDERING_SETTINGS.virtual.stepSize) * DEFAULT_RENDERING_SETTINGS.virtual.stepSize;
            lb = Math.max(lb, 0);
            ub = Math.min(ub, viewModelHeight);
            return {
                scroll: {
                    top: scrollTop,
                    // Make sure we respect the top padding when computing the scroll window.
                    // When we're on the "first page", we have to subtract the top padding from the container height.
                    height: Math.max(containerSize.height - paddingTop + Math.min(scrollTop, paddingTop), 0)
                },
                virtual: {
                    top: lb,
                    height: ub - lb
                }
            };
        } else {
            // The user didn't scoll, just render the container
            let ub = Math.ceil((containerSize.height + DEFAULT_RENDERING_SETTINGS.virtual.prerenderSize) / DEFAULT_RENDERING_SETTINGS.virtual.stepSize) * DEFAULT_RENDERING_SETTINGS.virtual.stepSize;
            ub = Math.min(ub, viewModelHeight);
            return {
                scroll: {
                    top: 0,
                    height: Math.max(containerSize.height, paddingTop) - paddingTop
                },
                virtual: {
                    top: 0,
                    height: ub
                }
            };
        }
    }, [viewModel, renderColumns, scrollTop, containerSize]);

    // The current state
    const stateRef = React.useRef<RenderingState | null>(null);
    // Memo must depend on scroll window and window size
    const renderedOutput = React.useMemo<RenderingOutput>(() => {
        // Is the rendering state empty?
        if (stateRef.current == null) {
            stateRef.current = {
                nodePositions: new Map(),
                edgePaths: new Map(),
            };
        }
        // No state or measured container size?
        if (!viewModel || !renderingWindow) {
            return {
                nodes: [],
                edges: [],
                edgesFocused: [],
                totalWidth: 0,
                totalHeight: 0,
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
        const [newState, output] = renderCatalog(stateRef.current, viewModel, renderColumns);
        stateRef.current = newState;
        return output;

    }, [viewModelVersion, renderingWindow]);

    let totalWidth = renderedOutput?.totalWidth ?? containerSize?.width ?? 0;
    let totalHeight = renderedOutput?.totalHeight ?? containerSize?.height ?? 0;

    // Adjust top padding
    paddingTop = Math.max(Math.max((containerSize?.height ?? 0) - renderedOutput?.totalHeight, 0) / 2, 20);
    paddingBottom = paddingTop;
    return (
        <div className={styles.root}>
            <div
                className={styles.board_container}
                ref={containerElement}
                onScroll={handleScroll}
            >
                <div className={styles.board_container_shadows}>
                    <div
                        className={styles.board}
                        ref={boardElement}
                        style={{
                            minHeight: viewModelHeight
                        }}
                    >
                        <EdgeLayer
                            className={styles.edge_layer}
                            width={totalWidth}
                            height={totalHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            paths={renderedOutput.edges ?? []}
                        />
                        <EdgeLayer
                            className={styles.edge_layer_focused}
                            width={totalWidth}
                            height={totalHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            paths={renderedOutput.edgesFocused ?? []}
                        />
                        <NodeLayer
                            width={totalWidth}
                            height={totalHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            nodes={renderedOutput.nodes ?? []}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
