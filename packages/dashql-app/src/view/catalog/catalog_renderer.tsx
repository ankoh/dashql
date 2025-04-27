import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './catalog_renderer.module.css';
import { motion } from 'framer-motion';

import { EdgePathBuilder, NodePort } from './graph_edges.js';
import { classNames } from '../../utils/classnames.js';
import { buildEdgePath, selectHorizontalEdgeType } from './graph_edges.js';
import { CatalogViewModel, CatalogRenderingFlag, PINNED_BY_ANYTHING, PINNED_BY_FOCUS_PATH, PINNED_BY_FOCUS, CatalogLevel } from './catalog_view_model.js';

/// A rendering path.
/// A cheap way to track the path of parent ids when rendering the catalog.
class RenderingPath {
    /// The entries ids
    public entryIds: Uint32Array;

    constructor() {
        this.entryIds = new Uint32Array(4);
    }
    public reset() {
        this.entryIds[0] = 0xFFFFFFFF;
        this.entryIds[1] = 0xFFFFFFFF;
        this.entryIds[2] = 0xFFFFFFFF;
        this.entryIds[4] = 0xFFFFFFFF;
    }
    public truncate(level: number) {
        for (let i = level + 1; i < 4; ++i) {
            this.entryIds[i] = 0xFFFFFFFF;
        }
    }
    public select(level: number, id: number) {
        this.entryIds[level] = id;
    }
    public getKeyPrefix(level: number) {
        if (level == 0) {
            return '';
        } else {
            let out = this.entryIds[0]!.toString();
            for (let i = 1; i < level; ++i) {
                out += '/';
                out += this.entryIds[i]!.toString();
            }
            return out;
        }
    }
    public getKey(level: number) {
        let out = this.entryIds[0]!.toString();
        for (let i = 1; i < (level + 1); ++i) {
            out += '/';
            out += this.entryIds[i]!.toString();
        }
        return out;
    }
}

class VirtualRenderingWindowStats {
    /// Minimum position in the scroll window
    minInScrollWindow: number;
    /// Maximum position in the scroll window
    maxInScrollWindow: number;

    constructor(tracker: VirtualRenderingWindow) {
        this.minInScrollWindow = tracker.scrollWindowEnd;
        this.maxInScrollWindow = tracker.scrollWindowBegin;
    }
    reset(tracker: VirtualRenderingWindow) {
        this.minInScrollWindow = tracker.scrollWindowEnd;
        this.maxInScrollWindow = tracker.scrollWindowBegin;
    }
    centerInScrollWindow(): number | null {
        if (this.minInScrollWindow <= this.maxInScrollWindow) {
            return this.minInScrollWindow + (this.maxInScrollWindow - this.minInScrollWindow) / 2;
        } else {
            return null;
        }
    }
}

class VirtualRenderingWindow {
    /// The begin offset of the actual scroll window
    scrollWindowBegin: number;
    /// The end offset of the actual scroll window
    scrollWindowEnd: number;
    /// The begin offset of the virtual scroll window
    virtualScrollWindowBegin: number;
    /// The end offset of the virtual scroll window
    virtualScrollWindowEnd: number;
    /// The statistics count
    statisticsCount: number;
    /// The rendering boundaries
    statistics: VirtualRenderingWindowStats[]

    constructor(begin: number, end: number, virtualBegin: number, virtualEnd: number) {
        this.scrollWindowBegin = begin;
        this.scrollWindowEnd = end;
        this.virtualScrollWindowBegin = virtualBegin;
        this.virtualScrollWindowEnd = virtualEnd;
        this.statisticsCount = 1;
        this.statistics = [
            new VirtualRenderingWindowStats(this),
            new VirtualRenderingWindowStats(this),
            new VirtualRenderingWindowStats(this),
            new VirtualRenderingWindowStats(this),
            new VirtualRenderingWindowStats(this),
        ];
    }
    startRenderingChildren() {
        this.statistics[this.statisticsCount].reset(this);
        ++this.statisticsCount;
    }
    stopRenderingChildren(): VirtualRenderingWindowStats {
        return this.statistics[--this.statisticsCount];
    }
    addNode(pos: number, height: number) {
        const stats = this.statistics[this.statisticsCount - 1];
        const begin = pos;
        const end = pos + height;
        if (end > this.scrollWindowBegin && begin < this.scrollWindowEnd) {
            stats.minInScrollWindow = Math.min(stats.minInScrollWindow, begin);
            stats.maxInScrollWindow = Math.max(stats.maxInScrollWindow, end);
        }
    }
}

export interface RenderedPath {
    key: string;
    initial: {
        d: string,
        pathLength?: number,
        pathOffset?: number,
        scale?: number,
        opacity?: number;
    };
    animate: {
        d: string,
        pathLength?: number,
        pathOffset?: number,
        scale?: number,
        opacity?: number;
    };
}

export interface RenderedNode {
    key: string;
    initial: {
        top: number;
        left: number;
        scale: number;
    };
    animate: {
        top: number;
        left: number;
        scale: number;
    };
}

export interface RenderingState {
    /// The rendered nodes
    nodePositions: Map<string, RenderedNode>;
    /// The rendered edges
    edgePaths: Map<string, RenderedPath>;
}

export interface RenderingOutput {
    /// The nodes
    nodes: React.ReactElement[];
    /// The edges
    edges: React.ReactElement[];
    /// The focused edges
    edgesFocused: React.ReactElement[];
    /// The total width
    totalWidth: number;
}

interface RenderingContext {
    /// The viewModel
    viewModel: CatalogViewModel;
    /// The snapshot
    snapshot: dashql.DashQLCatalogSnapshotReader;
    /// The rendering epoch
    renderingEpoch: number;
    /// Render Columns?
    renderColumns: boolean;
    /// The x-positions per level
    levelPositionsX: number[];
    /// The level widths
    levelWidths: number[];
    /// The current writer on the vertical axis
    currentWriterY: number;
    /// The rendering path
    renderingPath: RenderingPath;
    /// The virtual rendering window
    renderingWindow: VirtualRenderingWindow;
    /// The edge builder
    edgeBuilder: EdgePathBuilder;
    /// The previous state
    prevState: RenderingState;
    /// The next pistate
    nextState: RenderingState;
    /// The output nodes
    output: RenderingOutput;
};

const LEVEL_NAMES = [
    "database",
    "schema",
    "table",
    "column"
];

const NODE_INITIAL_X_OFFSET = 8;
const NODE_INITIAL_SCALE = 1.0;
const NODE_TRANSITION = {
    duration: 0.3,
    ease: "easeInOut"
};

const EDGE_INITIAL_SCALE = 1.0;
const EDGE_INITIAL_PATH_LENGTH = 0;
const EDGE_INITIAL_PATH_OFFSET = 1.0;
const EDGE_INITIAL_OPACITY = 0.5;
const EDGE_TRANSITION = {
    duration: 0.3,
    ease: "easeInOut"
};

/// Render entries and emit ReactElements if they are within the virtual scroll window
function renderEntriesAtLevel(ctx: RenderingContext, levelId: number, entriesBegin: number, entriesCount: number, parentEntryId: number | null, parentIsFocused: boolean) {
    const levels = ctx.viewModel.levels;
    const thisLevel = levels[levelId];
    const settings = thisLevel.settings;
    const entries = thisLevel.entries;
    const scratchEntry = thisLevel.scratchEntry;
    const flags = thisLevel.entryFlags;
    const levelPositionX = ctx.levelPositionsX[levelId];
    const levelWidth = ctx.levelWidths[levelId];
    const positionsY = thisLevel.positionsY;
    const renderingEpochs = thisLevel.renderedInEpoch;
    const renderChildren = ctx.renderColumns || ((levelId + 1) < CatalogLevel.Column);
    const subtreeHeights = ctx.renderColumns
        ? thisLevel.subtreeHeights.withColumns
        : thisLevel.subtreeHeights.withoutColumns;

    // Track overflow nodes
    let overflowChildCount = 0;
    let lastOverflowEntryId = 0;
    let isFirst = true;

    let levelName = LEVEL_NAMES[levelId];

    // First render all pinned entries, then all unpinned
    for (const renderPinned of [true, false]) {
        overflowChildCount = 0;
        for (let i = 0; i < entriesCount; ++i) {
            // Resolve table
            const entryId = entriesBegin + i;
            const entryFlags = flags[entryId];
            const entryIsPinned = (entryFlags & PINNED_BY_ANYTHING) != 0;
            const entryIsFocused = (entryFlags & PINNED_BY_FOCUS) != 0;
            // Quickly skip over irrelevant entries
            if (entryIsPinned != renderPinned) {
                continue;
            }
            // Skip overflow entries
            if ((entryFlags & CatalogRenderingFlag.OVERFLOW) != 0) {
                ++overflowChildCount;
                lastOverflowEntryId = entryId;
                continue;
            }
            // Update rendering path
            ctx.renderingPath.select(levelId, entryId);
            // Add row gap when first
            ctx.currentWriterY += isFirst ? 0 : settings.rowGap;
            isFirst = false;
            // Remember own position
            let thisPosY = ctx.currentWriterY;
            // Read the entry
            const entry = entries.read(ctx.snapshot, entryId, scratchEntry)!;
            // Track the center in the scroll window above the children.
            // This position is the center above all rendered children.
            let centerInScrollWindow: number | null = null;
            // Is the subtree entirely below the virtual window?
            // Then we just skip rendering completely.
            if ((thisPosY + subtreeHeights[entryId]) <= ctx.renderingWindow.virtualScrollWindowBegin) {
                ctx.currentWriterY += subtreeHeights[entryId];
                centerInScrollWindow = thisPosY;
            } else if (renderChildren && entry.childCount() > 0) {
                ctx.renderingWindow.startRenderingChildren();
                renderEntriesAtLevel(ctx, levelId + 1, entry.childBegin(), entry.childCount(), entryId, entryIsFocused);
                const stats = ctx.renderingWindow.stopRenderingChildren();
                centerInScrollWindow = stats.centerInScrollWindow();
            }
            // Bump writer if the columns didn't already
            ctx.currentWriterY = Math.max(ctx.currentWriterY, thisPosY + settings.nodeHeight);
            // Truncate any stack items that children added
            ctx.renderingPath.truncate(levelId);
            // Vertically center the node over all child nodes
            thisPosY = centerInScrollWindow == null ? thisPosY : (centerInScrollWindow - settings.nodeHeight / 2);
            // Break if lower bound is larger than virtual window
            if (thisPosY >= ctx.renderingWindow.virtualScrollWindowEnd) {
                break;
            }
            // Skip if upper bound is smaller than virtual window
            if (ctx.currentWriterY < ctx.renderingWindow.virtualScrollWindowBegin) {
                continue;
            }
            // Remember the node position
            ctx.renderingWindow.addNode(thisPosY, settings.nodeHeight);
            positionsY[entryId] = thisPosY;
            renderingEpochs[entryId] = ctx.renderingEpoch;
            // Determine if any child is focused
            let anyChildIsFocused = false;
            if (renderChildren && entry.childCount() > 0) {
                for (let i = 0; i < entry.childCount(); ++i) {
                    const level = levels[levelId + 1];
                    anyChildIsFocused ||= (level.entryFlags[entry.childBegin() + i] & PINNED_BY_FOCUS) != 0;
                }
            }
            // Build the node key
            const thisKey = ctx.renderingPath.getKey(levelId);
            const thisName = ctx.snapshot.readName(entry.nameId());
            // Resolve the previous node
            const prevNodePosition = ctx.prevState.nodePositions.get(thisKey);
            const newNodePosition: RenderedNode = {
                key: thisKey,
                initial: prevNodePosition?.animate ?? (
                    (entryIsPinned || entryIsFocused)
                        ? {
                            top: thisPosY,
                            left: levelPositionX + NODE_INITIAL_X_OFFSET,
                            scale: NODE_INITIAL_SCALE,
                        }
                        : {
                            top: thisPosY,
                            left: levelPositionX,
                            scale: 1.0,
                        }
                ),
                animate: {
                    top: thisPosY,
                    left: levelPositionX,
                    scale: 1.0,
                },
            };
            ctx.nextState.nodePositions.set(thisKey, newNodePosition);
            // Output node
            ctx.output.nodes.push(
                <motion.div
                    key={thisKey}
                    className={classNames(styles.node, {
                        [styles.node_pinned_script_table_ref]: (entryFlags & CatalogRenderingFlag.SCRIPT_TABLE_REF) != 0,
                        [styles.node_pinned_script_table_ref_path]: (entryFlags & CatalogRenderingFlag.SCRIPT_TABLE_REF_PATH) != 0,
                        [styles.node_pinned_script_column_ref]: (entryFlags & CatalogRenderingFlag.SCRIPT_COLUMN_REF) != 0,
                        [styles.node_pinned_script_column_ref_path]: (entryFlags & CatalogRenderingFlag.SCRIPT_COLUMN_REF_PATH) != 0,
                        [styles.node_pinned_focus_target]: (entryFlags & PINNED_BY_FOCUS) != 0,
                        [styles.node_pinned_focus_path]: (entryFlags & PINNED_BY_FOCUS_PATH) != 0,
                        [styles.node_pinned]: (entryFlags & PINNED_BY_ANYTHING) != 0
                    })}
                    style={{
                        position: 'absolute',
                        width: levelWidth,
                        height: settings.nodeHeight,
                    }}
                    initial={newNodePosition.initial}
                    animate={newNodePosition.animate}
                    transition={NODE_TRANSITION}
                    data-snapshot-entry={thisKey}
                    data-snapshot-level={levelId.toString()}
                    data-catalog-object={entry.catalogObjectId()}
                >
                    {
                        (
                            thisName == ""
                                ? (
                                    <div className={styles.node_label_empty}>
                                        &lt;no {levelName}&gt;
                                    </div>
                                )
                                : (
                                    <div className={styles.node_label}>
                                        {thisName}
                                    </div>
                                )
                        )
                    }
                    {((entryFlags & PINNED_BY_ANYTHING) != 0) && (
                        <div className={styles.node_count}>
                            {0}
                        </div>
                    )}
                    <div className={styles.node_ports}>
                        {(parentEntryId != null) && (
                            <div
                                className={classNames(styles.node_port_west, {
                                    [styles.node_port_border_default]: !entryIsFocused,
                                    [styles.node_port_border_focused]: entryIsFocused,
                                    [styles.node_port_focused]: parentIsFocused && entryIsFocused,
                                })}
                                data-port={NodePort.West}
                            />
                        )}
                        {renderChildren && (entry.childCount() > 0) && (
                            <div
                                className={classNames(styles.node_port_east, {
                                    [styles.node_port_border_default]: !entryIsFocused,
                                    [styles.node_port_border_focused]: entryIsFocused,
                                    [styles.node_port_focused]: anyChildIsFocused,
                                })}
                                data-port={NodePort.East}
                            />
                        )}
                    </div>
                </motion.div>
            );
            // Draw edges to all children
            if (entry.childCount() > 0) {
                const fromX = levelPositionX + levelWidth / 2;
                const fromY = thisPosY + settings.nodeHeight / 2;
                const fromWidth = levelWidth;
                const toSettings = ctx.viewModel.levels[levelId + 1].settings;
                const toPositionsY = ctx.viewModel.levels[levelId + 1].positionsY;
                const toX = ctx.levelPositionsX[levelId + 1] + ctx.levelWidths[levelId + 1] / 2;
                const toEpochs = ctx.viewModel.levels[levelId + 1].renderedInEpoch;
                const toFlags = ctx.viewModel.levels[levelId + 1].entryFlags;
                const toWidth = ctx.levelWidths[levelId + 1];

                for (let i = 0; i < entry.childCount(); ++i) {
                    const toEntryId = entry.childBegin() + i;
                    // Don't draw an edge to nodes that were not rendered this epoch
                    if (toEpochs[toEntryId] != ctx.renderingEpoch) {
                        continue;;
                    }
                    const toY = toPositionsY[toEntryId] + toSettings.nodeHeight / 2;
                    const edgeType = selectHorizontalEdgeType(fromX, fromY, toX, toY);
                    const edgePath = buildEdgePath(ctx.edgeBuilder, edgeType, fromX, fromY, toX, toY, fromWidth, settings.nodeHeight, toWidth, toSettings.nodeHeight, 4);
                    const edgeKey = `${thisKey}:${i}`;
                    // Resolve the previous path
                    const prevPath = ctx.prevState.edgePaths.get(edgeKey);
                    const nextPath: RenderedPath = {
                        key: thisKey,
                        initial: prevPath?.animate ?? (
                            {
                                d: edgePath,
                                pathLength: EDGE_INITIAL_PATH_LENGTH,
                                pathOffset: EDGE_INITIAL_PATH_OFFSET,
                                scale: EDGE_INITIAL_SCALE,
                                opacity: EDGE_INITIAL_OPACITY,
                            }
                        ),
                        animate: {
                            d: edgePath,
                            pathLength: 1.0,
                            pathOffset: 0.0,
                            scale: 1.0,
                            opacity: 1.0
                        }
                    };
                    ctx.nextState.edgePaths.set(edgeKey, nextPath);

                    // Is his a focused edge?
                    const toEntryFlags = toFlags[toEntryId];
                    const pinnedByCompletion = CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE_PATH | CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE;
                    if (((entryFlags & pinnedByCompletion) != 0) && ((toEntryFlags & pinnedByCompletion) != 0)) {
                        ctx.output.edgesFocused.push(
                            <motion.path
                                key={edgeKey}
                                initial={nextPath.initial}
                                animate={nextPath.animate}
                                transition={EDGE_TRANSITION}
                                strokeWidth="2px"
                                stroke="currentcolor"
                                fill="transparent"
                                pointerEvents="stroke"
                                strokeDasharray="10"
                                strokeDashoffset="1"
                                data-edge={edgeKey}
                            />
                        );
                    } else if (((entryFlags & PINNED_BY_FOCUS) != 0) && ((toEntryFlags & PINNED_BY_FOCUS) != 0)) {
                        ctx.output.edgesFocused.push(
                            <motion.path
                                key={edgeKey}
                                initial={nextPath.initial}
                                animate={nextPath.animate}
                                transition={EDGE_TRANSITION}
                                strokeWidth="2px"
                                stroke="currentcolor"
                                fill="transparent"
                                pointerEvents="stroke"
                                data-edge={edgeKey}
                            />,
                        );
                    } else {
                        ctx.output.edges.push(
                            <motion.path
                                key={edgeKey}
                                initial={nextPath.initial}
                                animate={nextPath.animate}
                                transition={EDGE_TRANSITION}
                                strokeWidth="2px"
                                stroke="currentcolor"
                                fill="transparent"
                                pointerEvents="stroke"
                                data-edge={edgeKey}
                            />,
                        );
                    }
                }
            }
        }
    }

    // Render overflow entry
    if (overflowChildCount > 0) {
        ctx.currentWriterY += settings.rowGap;
        const thisPosY = ctx.currentWriterY;
        ctx.currentWriterY += settings.nodeHeight;

        if (ctx.currentWriterY > ctx.renderingWindow.virtualScrollWindowBegin && thisPosY < ctx.renderingWindow.virtualScrollWindowEnd) {
            ctx.renderingWindow.addNode(thisPosY, settings.nodeHeight);
            positionsY[lastOverflowEntryId] = thisPosY;
            renderingEpochs[lastOverflowEntryId] = ctx.renderingEpoch;
            const key = ctx.renderingPath.getKeyPrefix(levelId);
            const overflowKey = `${key}:overflow`;

            // Resolve the previous node
            const prevNodePosition = ctx.prevState.nodePositions.get(overflowKey);
            const newNodePosition: RenderedNode = {
                key: overflowKey,
                initial: prevNodePosition?.animate ?? (
                    {
                        top: thisPosY,
                        left: levelPositionX,
                        scale: 1.0,
                    }),
                animate: {
                    top: thisPosY,
                    left: levelPositionX,
                    scale: 1.0,
                },
            };
            ctx.nextState.nodePositions.set(overflowKey, newNodePosition);

            ctx.output.nodes.push(
                <motion.div
                    key={overflowKey}

                    className={classNames(styles.node, styles.node_overflow)}
                    style={{
                        position: 'absolute',
                        width: levelWidth,
                        height: settings.nodeHeight,
                    }}
                    initial={newNodePosition.initial}
                    animate={newNodePosition.animate}
                    transition={NODE_TRANSITION}
                    data-snapshot-entry={key}
                    data-snapshot-level={levelId.toString()}
                >
                    {overflowChildCount} more

                </motion.div>
            );
        }
    }
}

/// A function to render a catalog
export function renderCatalog(state: RenderingState, viewModel: CatalogViewModel, withColumns: boolean): [RenderingState, RenderingOutput] {
    // Compute x positions
    let writerX = 0;
    let levelPositionsX: number[] = [0, 0, 0, 0];
    let levelWidths: number[] = [0, 0, 0, 0];
    for (let i = 0; i < (withColumns ? viewModel.levels.length : (viewModel.levels.length - 1)); ++i) {
        const settings = viewModel.levels[i].settings;
        writerX += settings.columnGap;
        levelPositionsX[i] = writerX;
        const levelWidth = settings.nodeWidth;
        levelWidths[i] = levelWidth;
        writerX += levelWidth;
    }

    const ctx: RenderingContext = {
        viewModel,
        snapshot: viewModel.snapshot.read(),
        renderingEpoch: viewModel.nextRenderingEpoch++,
        renderColumns: withColumns,
        levelPositionsX,
        levelWidths,
        currentWriterY: 0,
        renderingPath: new RenderingPath(),
        renderingWindow: new VirtualRenderingWindow(viewModel.scrollBegin, viewModel.scrollEnd, viewModel.virtualScrollBegin, viewModel.virtualScrollEnd),
        edgeBuilder: new EdgePathBuilder(),
        prevState: state,
        nextState: {
            nodePositions: new Map(),
            edgePaths: new Map(),
        },
        output: {
            nodes: [],
            edges: [],
            edgesFocused: [],
            totalWidth: writerX,
        }
    };
    renderEntriesAtLevel(ctx, 0, 0, viewModel.databaseEntries.entries.length(ctx.snapshot), null, false);
    return [ctx.nextState, ctx.output];
}
