import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import * as styles from './catalog_viewer.module.css'

import { CatalogRenderingSettings, CatalogViewModel } from './catalog_view_model.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus } from '../../connection/catalog_update_state.js';
import { EdgeLayer } from './edge_layer.js';
import { FOCUSED_COMPLETION, FOCUSED_EXPRESSION_ID, FOCUSED_TABLE_REF_ID } from '../../workbook/focus.js';
import { NodeLayer } from './node_layer.js';
import { ScriptData, WorkbookState } from '../../workbook/workbook_state.js';
import { U32_MAX } from '../../utils/numeric_limits.js';
import { observeSize } from '../foundations/size_observer.js';
import { renderCatalog, RenderingOutput, RenderingState } from './catalog_renderer.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useThrottledMemo } from '../../utils/throttle.js';
import { useWorkbookState } from '../../workbook/workbook_state_registry.js';

export const PADDING_LEFT = 20;
export const PADDING_TOP = 4;
export const PADDING_BOTTOM = 16;
export const PADDING_RIGHT = 48;
export const RENDERING_SETTINGS: CatalogRenderingSettings = {
    virtual: {
        prerenderSize: 200,
        stepSize: 1,
    },
    levels: {
        databases: {
            nodeWidth: 240,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 24,
            childOffsetX: 48,
        },
        schemas: {
            nodeWidth: 240,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 24,
            childOffsetX: 48,
        },
        tables: {
            nodeWidth: 240,
            nodeHeight: 36,
            maxUnpinnedChildren: 5,
            levelGap: 8,
            rowGap: 8,
            childOffsetX: 48,
        },
        columns: {
            nodeWidth: 240,
            nodeHeight: 36,
            maxUnpinnedChildren: 3,
            levelGap: 8,
            rowGap: 8,
            childOffsetX: 0,
        },
    },
    details: {
        nodeWidth: 200,
        columnGap: 48,
    }
};

interface Props {
    workbookId: number;
}

export function CatalogViewer(props: Props) {
    const [workbook, _modifyWorkbook] = useWorkbookState(props.workbookId ?? null);
    const [conn, _connDispatch] = useConnectionState(workbook?.connectionId ?? null);
    const workbookEntry = workbook?.workbookEntries[workbook.selectedWorkbookEntry];
    const script = workbookEntry ? workbook.scripts[workbookEntry.scriptKey] : null;

    // Watch the container size
    const containerElement = React.useRef(null);
    const containerSize = observeSize(containerElement);
    const boardElement = React.useRef(null);

    // Maintain a catalog snapshot of the workbook
    const [viewModel, setViewModel] = React.useState<CatalogViewModel | null>(null);
    const [viewModelVersion, setViewModelVersion] = React.useState<number>(0);
    React.useEffect(() => {
        const snapshot = workbook?.connectionCatalog.createSnapshot() ?? null;
        if (snapshot) {
            const state = new CatalogViewModel(snapshot, RENDERING_SETTINGS);
            setViewModel(state);
        }
    }, [workbook?.connectionCatalog.snapshot]);
    const viewModelHeight = (viewModel?.totalHeight ?? 0) + PADDING_BOTTOM + PADDING_TOP;

    // Load script refs
    const previousScript = React.useRef<dashql.DashQLScript | null>(null);
    // Triggered whenever the catalog view model or the script buffers change
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
            // Ping script refs
            const analyzed = script.processed.analyzed.read();
            viewModel.pinScriptRefs(analyzed);
            // Restore the user focus.
            // We need to do this in the same useEffect if we want to get rid of flickering
            // XXX We'll double-pin focused now
            if (workbook?.userFocus) {
                viewModel.pinFocusedByUser(workbook.userFocus, true);
            }
            setViewModelVersion(v => v + 1);
        }

    }, [viewModel, script?.processed]);

    // React to user focus changes
    React.useEffect(() => {
        if (viewModel != null && workbook?.userFocus) {
            // Pin focused elements
            viewModel.pinFocusedByUser(workbook.userFocus, true);

            // Scroll to first focused entry
            let [scrollToFocus, found] = viewModel.getOffsetOfFirstFocused();
            if (found && containerElement.current != null && containerSize != null && boardElement.current != null) {
                const containerDiv = containerElement.current as HTMLDivElement;
                const boardDiv = boardElement.current as HTMLDivElement;
                const clientVerticalCenter = containerSize.height / 2;
                scrollToFocus = Math.max(scrollToFocus, clientVerticalCenter) - clientVerticalCenter;

                // XXX Are browsers doing the right thing here?
                //     Manual tests indicate that this is working...
                //     We manually bump the minimum height to make sure there's enough room for scrollTop.
                const newViewModelHeight = (viewModel?.totalHeight ?? 0) + PADDING_TOP + PADDING_BOTTOM;
                boardDiv.style.minHeight = `${newViewModelHeight}px`;
                containerDiv.scrollTop = scrollToFocus;
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

    // The current state
    const stateRef = React.useRef<RenderingState | null>(null);
    // Memo must depend on scroll window and window size
    const renderedOutput = React.useMemo<RenderingOutput>((): RenderingOutput => {
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
        const [newState, output] = renderCatalog(stateRef.current, viewModel);
        stateRef.current = newState;
        return output;

    }, [viewModelVersion, renderingWindow]);


    // Build the catalog info entries
    const catalogInfoEntries = useCatalogInfoEntries(workbook, script);
    // Resolve the latest full-refresh task
    const fullRefreshTask = React.useMemo<CatalogUpdateTaskState | null>(() => {
        const lastFullRefresh = conn?.catalogUpdates.lastFullRefresh ?? null;
        if (lastFullRefresh != null) {
            const task = conn!.catalogUpdates.tasksRunning.get(lastFullRefresh)
                ?? conn!.catalogUpdates.tasksFinished.get(lastFullRefresh)
                ?? null;
            return task;
        }
        return null;
    }, [conn?.catalogUpdates]);

    // Show the catalog full refresh status until the latest refresh succeeded
    const showRefreshView = fullRefreshTask != null
        && fullRefreshTask.status != CatalogUpdateTaskStatus.SUCCEEDED;

    // Should we always expand the info overlay?
    const widthWhenExpanded = (viewModel?.totalWidth ?? 0) + PADDING_LEFT + PADDING_RIGHT;
    let paddingLeft = PADDING_LEFT;
    let paddingRight = PADDING_RIGHT;

    // Use padding to center the catalog if the view model is smaller than the container height.
    const paddingTop = Math.max(PADDING_TOP, Math.max((containerSize?.height ?? 0) - (viewModel?.totalHeight ?? 0), 0) / 2);
    const paddingBottom = paddingTop;

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
                            width={layerWidth}
                            height={layerHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            paths={renderedOutput.edges ?? []}
                        />
                        <EdgeLayer
                            className={styles.edge_layer_focused}
                            width={layerWidth}
                            height={layerHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            paths={renderedOutput.edgesFocused ?? []}
                        />
                        <NodeLayer
                            width={layerWidth}
                            height={layerHeight}
                            paddingTop={paddingTop}
                            paddingRight={paddingRight}
                            paddingLeft={paddingLeft}
                            paddingBottom={paddingBottom}
                            nodes={renderedOutput.nodes}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function useCatalogInfoEntries(workbook: WorkbookState | null, script: ScriptData | null) {
    // Collect overlay metrics
    return React.useMemo<[string, string][]>(() => {
        const overlay: [string, string][] = [];

        // Inspect the cursor
        const cursor = script?.cursor;
        if (cursor && cursor.scannerSymbolId != U32_MAX) {
            const scanned = script.processed.scanned?.read();
            const tokens = scanned?.tokens();
            const tokenTypes = tokens?.tokenTypesArray();
            if (tokenTypes && cursor.scannerSymbolId < tokenTypes.length) {
                const tokenType = tokenTypes[cursor.scannerSymbolId];
                const tokenTypeName = dashql.getScannerTokenTypeName(tokenType);

                overlay.push([
                    "Token",
                    tokenTypeName
                ]);
            }
        }

        // Is there a user focus?
        const focusTarget = workbook?.userFocus?.focusTarget;
        switch (focusTarget?.type) {
            case FOCUSED_TABLE_REF_ID: {
                const tableRefObject = focusTarget.value.tableReference;
                const scriptKey = dashql.ContextObjectID.getContext(tableRefObject);
                const tableRefId = dashql.ContextObjectID.getObject(tableRefObject);
                const scriptData = workbook?.scripts[scriptKey];
                const analyzed = scriptData?.processed.analyzed;
                if (analyzed) {
                    const analyzedPtr = analyzed.read();
                    const tableRef = analyzedPtr.tableReferences(tableRefId)!;
                    const resolved = tableRef.resolvedTable()!;
                    if (resolved == null) {
                        overlay.push(["Table", "<unresolved>"]);
                    } else {
                        const tableName = resolved.tableName();
                        overlay.push(["Table", tableName?.tableName() ?? ""]);
                    }
                }
                break;
            }
            case FOCUSED_EXPRESSION_ID: {
                const expressionObject = focusTarget.value.expression;
                const scriptKey = dashql.ContextObjectID.getContext(expressionObject);
                const expressionId = dashql.ContextObjectID.getObject(expressionObject);
                const scriptData = workbook?.scripts[scriptKey];
                const analyzed = scriptData?.processed.analyzed;
                if (analyzed) {
                    const analyzedPtr = analyzed.read();
                    const expression = analyzedPtr.expressions(expressionId)!;
                    switch (expression.innerType()) {
                        case dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression: {
                            const inner = new dashql.buffers.algebra.ColumnRefExpression();
                            expression.inner(inner) as dashql.buffers.algebra.ColumnRefExpression;
                            const resolved = inner.resolvedColumn();
                            if (resolved == null) {
                                overlay.push(["Expression", "column reference"]);
                                overlay.push(["Column", "<unresolved>"]);
                            } else {
                                overlay.push(["Expression", "column reference"]);
                                const columnName = inner.columnName();
                                overlay.push(["Column", columnName?.columnName() ?? ""]);
                            }
                            break;
                        }
                    }
                }
                break;
            }
            case FOCUSED_COMPLETION: {
                switch (focusTarget.value.completion.strategy) {
                    case dashql.buffers.completion.CompletionStrategy.DEFAULT:
                        overlay.push(["Completion", "Default"]);
                        break;
                    case dashql.buffers.completion.CompletionStrategy.TABLE_REF:
                        overlay.push(["Completion", "Table Reference"]);
                        break;
                    case dashql.buffers.completion.CompletionStrategy.COLUMN_REF:
                        overlay.push(["Completion", "Column Reference"]);
                        break;
                }
                const completionCandidate = focusTarget.value.completion.candidates[focusTarget.value.completionCandidateIndex];
                overlay.push(["Candidate Score", `${completionCandidate.score}`]);
                break;
            }
        }

        return overlay;
    }, [workbook?.userFocus, script?.cursor]);
}
