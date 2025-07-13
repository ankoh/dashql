import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './catalog_renderer.module.css';
import * as symbols from '../../../static/svg/symbols.generated.svg';

import { motion } from 'framer-motion';

import { EdgePathBuilder, EdgeType, NodePort } from './graph_edges.js';
import { classNames } from '../../utils/classnames.js';
import { buildEdgePathBetweenRectangles } from './graph_edges.js';
import { CatalogViewModel, CatalogRenderingFlag, PINNED_BY_ANYTHING, PINNED_BY_FOCUS_PATH, PINNED_BY_FOCUS, PINNED_BY_COMPLETION, PINNED_BY_FOCUS_TARGET } from './catalog_view_model.js';

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
    /// The tracker
    renderingWindow: VirtualRenderingWindow;
    /// Minimum position in the scroll window
    minInScrollWindow: number;
    /// Maximum position in the scroll window
    maxInScrollWindow: number;
    /// The node count
    renderedNodes: number;
    /// Overflowing nodes
    overflowingNodes: number;
    /// The last overflowing node
    lastOverflowingNode: number | null;
    /// The number of nodes that we skipped below the scroll window
    nodesSkippedBelowWindow: number;
    /// The number of nodes that we skipped above the scroll window
    nodesSkippedAboveWindow: number;

    constructor(w: VirtualRenderingWindow) {
        this.renderingWindow = w;
        this.minInScrollWindow = w.scrollWindowEnd;
        this.maxInScrollWindow = w.scrollWindowBegin;
        this.renderedNodes = 0;
        this.overflowingNodes = 0;
        this.lastOverflowingNode = null;
        this.nodesSkippedBelowWindow = 0;
        this.nodesSkippedAboveWindow = 0;
    }
    reset(w: VirtualRenderingWindow) {
        this.renderingWindow = w;
        this.minInScrollWindow = w.scrollWindowEnd;
        this.maxInScrollWindow = w.scrollWindowBegin;
        this.renderedNodes = 0;
        this.overflowingNodes = 0;
        this.lastOverflowingNode = null;
        this.nodesSkippedBelowWindow = 0;
        this.nodesSkippedAboveWindow = 0;
    }
    addRenderedNode(pos: number, height: number) {
        this.renderedNodes += 1;
        const begin = pos;
        const end = pos + height;
        if (end > this.renderingWindow.scrollWindowBegin && begin < this.renderingWindow.scrollWindowEnd) {
            this.minInScrollWindow = Math.min(this.minInScrollWindow, begin);
            this.maxInScrollWindow = Math.max(this.maxInScrollWindow, end);
        }
    }
    addOverflowingNode(entryId: number) {
        this.overflowingNodes += 1;
        this.lastOverflowingNode = entryId;
    }
}

class VirtualRenderingWindow {
    /// The begin offset of the actual scroll window
    scrollWindowBegin: number;
    /// The end offset of the actual scroll window
    scrollWindowEnd: number;
    /// The height offset of the actual scroll window
    scrollWindowHeight: number;
    /// The begin offset of the virtual scroll window
    virtualScrollWindowBegin: number;
    /// The end offset of the virtual scroll window
    virtualScrollWindowEnd: number;
    /// The height of the virtual scroll window
    virtualScrollWindowHeight: number;
    /// The statistics count
    statisticsCount: number;
    /// The rendering boundaries
    statistics: VirtualRenderingWindowStats[]

    constructor(begin: number, end: number, virtualBegin: number, virtualEnd: number) {
        this.scrollWindowBegin = begin;
        this.scrollWindowEnd = end;
        this.scrollWindowHeight = end - begin;
        this.virtualScrollWindowBegin = virtualBegin;
        this.virtualScrollWindowEnd = virtualEnd;
        this.virtualScrollWindowHeight = virtualEnd - virtualBegin;
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
        this.statistics[this.statisticsCount++].reset(this);
    }
    stopRenderingChildren(): VirtualRenderingWindowStats {
        return this.statistics[--this.statisticsCount];
    }
    get stats(): VirtualRenderingWindowStats {
        return this.statistics[this.statisticsCount - 1];
    }
    getFractionOfScrollWindow(pos: number) {
        return Math.min(Math.max(pos, this.scrollWindowBegin) - this.scrollWindowBegin, this.scrollWindowHeight) / this.scrollWindowHeight;
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
        right: number;
        scale: number;
    };
    animate: {
        top: number;
        right: number;
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
}

interface RenderingContext {
    /// The viewModel
    viewModel: CatalogViewModel;
    /// The snapshot
    snapshot: dashql.DashQLCatalogSnapshotReader;
    /// The rendering epoch
    renderingEpoch: number;
    /// The latest focus epoch
    latestFocusEpoch: number | null;
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

const DEFAULT_NODE_INITIAL_X_OFFSET = 0;
const DEFAULT_NODE_INITIAL_SCALE = 1.0;
const DEFAULT_NODE_TRANSITION = {
    duration: 0.2,
    ease: "easeInOut"
};
const DEFAULT_EDGE_TRANSITION = {
    duration: 0.1,
    ease: "easeInOut"
};

const LEVEL_ICONS = [
    `#database`,
    `#namespace_24`,
    `#table_24`,
    `#columns_24`,
];

/// Render entries and emit ReactElements if they are within the virtual scroll window
function renderEntriesAtLevel(ctx: RenderingContext, levelId: number, entriesBegin: number, entriesCount: number, parentEntryId: number | null, parentIsFocused: boolean) {
    const levels = ctx.viewModel.levels;
    const thisLevel = levels[levelId];
    const thisLevelName = LEVEL_NAMES[levelId];
    const entries = thisLevel.entries;
    const flags = thisLevel.entryFlags;
    const levelPositionX = thisLevel.positionX;
    const levelSubtreeHeights = thisLevel.subtreeHeights;
    const levelWidth = thisLevel.settings.nodeWidth;
    const positionsY = thisLevel.positionsY;
    const renderingEpochs = thisLevel.renderedInEpoch;
    const scratchEntry = thisLevel.scratchEntry;
    const settings = thisLevel.settings;
    const stats = ctx.renderingWindow.stats;
    const isLastLevel = (levelId + 1) >= ctx.viewModel.visibleLevels;
    let isFirstEntry = true;

    // First render all pinned entries, then all unpinned
    for (const renderPinned of [true, false]) {
        for (let i = 0; i < entriesCount; ++i) {
            // Resolve table
            const entryId = entriesBegin + i;
            const entryFlags = flags[entryId];
            const entryIsPinned = (entryFlags & PINNED_BY_ANYTHING) != 0;
            const entryIsFocused = (entryFlags & PINNED_BY_FOCUS) != 0;
            const entryIsFocusTarget = (entryFlags & PINNED_BY_FOCUS_TARGET) != 0;
            const entryIsCompletion = (entryFlags & PINNED_BY_COMPLETION) != 0 && thisLevel.pinnedInEpoch[entryId] == ctx.latestFocusEpoch;
            // Quickly skip over irrelevant entries
            if (entryIsPinned != renderPinned) {
                continue;
            }
            // Break if writer is larger than virtual window upper bound
            if (ctx.currentWriterY >= ctx.renderingWindow.virtualScrollWindowEnd) {
                stats.nodesSkippedAboveWindow += entriesCount - i;
                break;
            }
            // Skip overflow entries
            if ((entryFlags & CatalogRenderingFlag.OVERFLOW) != 0) {
                stats.addOverflowingNode(entryId);
                continue;
            }
            // Update rendering path
            ctx.renderingPath.select(levelId, entryId);
            // Add row gap when first
            ctx.currentWriterY += isFirstEntry ? settings.levelGap : settings.rowGap;
            isFirstEntry = false;
            // Remember own position
            let thisPosY = ctx.currentWriterY;
            // Read the entry
            const entry = entries.read(ctx.snapshot, entryId, scratchEntry)!;
            // Is the subtree entirely below the virtual window?
            // Then we just skip rendering completely.
            let childStats: VirtualRenderingWindowStats | null = null;
            let renderedAnyChildren = false;
            if ((thisPosY + levelSubtreeHeights[entryId]) <= ctx.renderingWindow.virtualScrollWindowBegin) {
                // The subtree height includes the own node height
                ctx.currentWriterY += levelSubtreeHeights[entryId];
            } else {
                // Add our own node height
                ctx.currentWriterY += settings.nodeHeight;
                // Then render the children
                if (!isLastLevel && entry.childCount() > 0) {
                    ctx.renderingWindow.startRenderingChildren();
                    renderEntriesAtLevel(ctx, levelId + 1, entry.childBegin(), entry.childCount(), entryId, entryIsFocused);
                    childStats = ctx.renderingWindow.stopRenderingChildren();
                    renderedAnyChildren = childStats.renderedNodes > 0;
                    // Truncate any stack items that children added
                    ctx.renderingPath.truncate(levelId);
                }
            }
            // Skip if writer is smaller than virtual window lower bound.
            // Note that this means that all children are also smaller.
            // IF any child is reaching into the scroll window, we'll render
            if (ctx.currentWriterY < ctx.renderingWindow.virtualScrollWindowBegin && !renderedAnyChildren) {
                stats.nodesSkippedBelowWindow += 1;
                continue;
            }
            // Remember the node position
            stats.addRenderedNode(thisPosY, settings.nodeHeight);
            positionsY[entryId] = thisPosY;
            renderingEpochs[entryId] = ctx.renderingEpoch;
            // Determine if any child is focused
            let anyChildIsFocused = false;
            if (!isLastLevel && entry.childCount() > 0) {
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
                    {
                        top: thisPosY,
                        right: levelPositionX + DEFAULT_NODE_INITIAL_X_OFFSET,
                        scale: DEFAULT_NODE_INITIAL_SCALE,
                    }
                ),
                animate: {
                    top: thisPosY,
                    right: levelPositionX,
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
                    transition={DEFAULT_NODE_TRANSITION}
                    data-snapshot-entry={thisKey}
                    data-snapshot-level={levelId.toString()}
                    data-catalog-object={entry.catalogObjectId()}
                >
                    {
                        (
                            thisName == ""
                                ? (
                                    <div className={styles.node_label_empty}>
                                        &lt;no {thisLevelName}&gt;
                                    </div>
                                )
                                : (
                                    <div className={styles.node_label}>
                                        {thisName}
                                    </div>
                                )
                        )
                    }
                    <div className={styles.node_type_icon_container}>
                        <svg width="10px" height="10px">
                            <use xlinkHref={`${symbols}${LEVEL_ICONS[levelId]}`} />
                        </svg>
                    </div>
                    <div className={styles.node_ports}>
                        {(parentEntryId != null) && (
                            <div
                                className={classNames(styles.node_port_east, {
                                    [styles.node_port_border_default]: !entryIsFocused,
                                    [styles.node_port_border_focused]: entryIsFocused,
                                    [styles.node_port_focused]: parentIsFocused && entryIsFocused,
                                })}
                                data-port={NodePort.East}
                            />
                        )}
                    </div>
                </motion.div>
            );
            // Draw edges to all children
            if (entry.childCount() > 0) {
                // buildEdgePath is drawing from center points
                const fromX = levelPositionX + settings.childOffsetX / 2;
                const fromY = thisPosY + settings.nodeHeight / 2;
                // We want to start the edge in the mid of the child offset
                const fromWidth = settings.childOffsetX;
                const toSettings = levels[levelId + 1].settings;
                const toPositionsY = levels[levelId + 1].positionsY;
                const toX = levels[levelId + 1].positionX + levels[levelId + 1].settings.nodeWidth / 2;
                const toRenderedInEpoch = levels[levelId + 1].renderedInEpoch;
                const toPinnedInEpoch = levels[levelId + 1].pinnedInEpoch;
                const toFlags = levels[levelId + 1].entryFlags;
                const toWidth = levels[levelId + 1].settings.nodeWidth;

                for (let i = 0; i < entry.childCount(); ++i) {
                    const toEntryId = entry.childBegin() + i;
                    // Don't draw an edge to nodes that were not rendered this epoch
                    if (toRenderedInEpoch[toEntryId] != ctx.renderingEpoch) {
                        continue;
                    }
                    const toY = toPositionsY[toEntryId] + toSettings.nodeHeight / 2;
                    const edgePath = buildEdgePathBetweenRectangles(ctx.edgeBuilder, EdgeType.NorthEast, fromX, fromY, toX, toY, fromWidth, settings.nodeHeight, toWidth, toSettings.nodeHeight, 4);
                    const edgeKey = `${thisKey}:${i}`;
                    // Resolve the previous path
                    const prevPath = ctx.prevState.edgePaths.get(edgeKey);
                    const nextPath: RenderedPath = {
                        key: thisKey,
                        initial: prevPath?.animate ?? (
                            {
                                d: edgePath,
                            }
                        ),
                        animate: {
                            d: edgePath,
                        }
                    };
                    ctx.nextState.edgePaths.set(edgeKey, nextPath);

                    // Is his a focused edge?
                    const toEntryFlags = toFlags[toEntryId];
                    const toIsCompletion = (toEntryFlags & PINNED_BY_COMPLETION) != 0 && toPinnedInEpoch[entryId] == ctx.latestFocusEpoch;
                    if (entryIsCompletion && toIsCompletion) {
                        ctx.output.edgesFocused.push(
                            <motion.path
                                key={edgeKey}
                                initial={nextPath.initial}
                                animate={nextPath.animate}
                                transition={DEFAULT_EDGE_TRANSITION}
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
                                transition={DEFAULT_EDGE_TRANSITION}
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
                                transition={DEFAULT_EDGE_TRANSITION}
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

            // Is the focus target?
            if (isLastLevel && entryIsFocusTarget) {
                const detailsSettings = ctx.viewModel.settings.details;
                const detailsViewModel = ctx.viewModel.details;
                const detailsKey = "details";

                // Remember own position
                const detailsPosY = ctx.currentWriterY + detailsSettings.offsetY;
                const detailsPosX = thisLevel.positionX + settings.childOffsetX;
                ctx.currentWriterY = detailsPosY + detailsViewModel.height;

                // Resolve the previous node
                const prevNodePosition = ctx.prevState.nodePositions.get(detailsKey);
                const newNodePosition: RenderedNode = {
                    key: detailsKey,
                    initial: prevNodePosition?.animate ?? (
                        {
                            top: detailsPosY,
                            right: detailsPosX + DEFAULT_NODE_INITIAL_X_OFFSET,
                            scale: DEFAULT_NODE_INITIAL_SCALE,
                        }
                    ),
                    animate: {
                        top: detailsPosY,
                        right: detailsPosX,
                        scale: 1.0,
                    },
                };
                ctx.nextState.nodePositions.set(detailsKey, newNodePosition);

                ctx.output.nodes.push(
                    <motion.div
                        key={detailsKey}
                        className={classNames(styles.node, styles.node_details)}
                        style={{
                            position: 'absolute',
                            width: detailsSettings.nodeWidth,
                            height: detailsViewModel.height,
                        }}
                        initial={newNodePosition.initial}
                        animate={newNodePosition.animate}
                        transition={DEFAULT_NODE_TRANSITION}
                    >
                        <div className={styles.node_port_details} />
                        <div className={styles.node_details_content}>
                            <div className={styles.node_details_section_header}>
                                Restrictions
                            </div>
                            <div className={styles.node_details_section_entries}>
                                None
                            </div>
                            <div className={styles.node_details_section_header}>
                                Transforms
                            </div>
                            <div className={styles.node_details_section_entries}>
                                None
                            </div>
                        </div>
                    </motion.div>
                );

                const edgeFromX = levelPositionX + settings.childOffsetX / 2;
                const edgeFromY = thisPosY + settings.nodeHeight / 2;
                const edgeToX = detailsPosX + detailsSettings.nodeWidth / 2;
                const edgeToY = detailsPosY + settings.nodeHeight / 2; // Symmetry
                ctx.edgeBuilder.begin(edgeFromX, edgeFromY);
                ctx.edgeBuilder.push(edgeFromX, edgeFromY + ctx.viewModel.totalHeight);

                const edgePath = buildEdgePathBetweenRectangles(
                    ctx.edgeBuilder,
                    EdgeType.NorthEast,
                    edgeFromX, edgeFromY,
                    edgeToX, edgeToY,
                    settings.childOffsetX,
                    settings.nodeHeight,
                    detailsSettings.nodeWidth,
                    detailsViewModel.height,
                    4);

                // Resolve the previous path
                const prevPath = ctx.prevState.edgePaths.get(detailsKey);
                const nextPath: RenderedPath = {
                    key: thisKey,
                    initial: prevPath?.animate ?? (
                        {
                            d: edgePath,
                        }
                    ),
                    animate: {
                        d: edgePath,
                    }
                };
                ctx.nextState.edgePaths.set(detailsKey, nextPath);

                ctx.output.edgesFocused.push(
                    <motion.path
                        key={detailsKey}
                        initial={nextPath.initial}
                        animate={nextPath.animate}
                        transition={DEFAULT_EDGE_TRANSITION}
                        strokeWidth="2px"
                        stroke="currentcolor"
                        fill="transparent"
                        pointerEvents="stroke"
                    />
                );
            }

            // Are there are any children that were not rendered because they were exceeding the upper window boundary?
            // In that case, we draw a pseudo edge to hint that there are more.
            if (childStats != null && childStats.nodesSkippedAboveWindow > 0) {
                const edgeKey = `${thisKey}:bounds`;
                const fromX = levelPositionX + settings.childOffsetX / 2;
                const fromY = thisPosY + settings.nodeHeight;
                ctx.edgeBuilder.begin(fromX, fromY);
                ctx.edgeBuilder.push(fromX, fromY + ctx.viewModel.totalHeight);
                const edgePath = ctx.edgeBuilder.buildDirect();
                ctx.output.edges.push(
                    <motion.path
                        key={edgeKey}
                        initial={{
                            d: edgePath
                        }}
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

    // Render overflow entry
    const overflowCount = stats.overflowingNodes;
    if (overflowCount > 0) {
        const lastOverflowingNode = stats.lastOverflowingNode!;
        ctx.currentWriterY += settings.rowGap;
        const thisPosY = ctx.currentWriterY;
        ctx.currentWriterY += settings.nodeHeight;

        if (ctx.currentWriterY > ctx.renderingWindow.virtualScrollWindowBegin && thisPosY < ctx.renderingWindow.virtualScrollWindowEnd) {
            stats.addRenderedNode(thisPosY, settings.nodeHeight);
            positionsY[lastOverflowingNode!] = thisPosY;
            renderingEpochs[lastOverflowingNode!] = ctx.renderingEpoch;
            const key = ctx.renderingPath.getKeyPrefix(levelId);
            const overflowKey = `${key}:overflow`;

            // Resolve the previous node
            const prevNodePosition = ctx.prevState.nodePositions.get(overflowKey);
            const newNodePosition: RenderedNode = {
                key: overflowKey,
                initial: prevNodePosition?.animate ?? (
                    {
                        top: thisPosY,
                        right: levelPositionX + DEFAULT_NODE_INITIAL_X_OFFSET,
                        scale: 1.0,
                    }),
                animate: {
                    top: thisPosY,
                    right: levelPositionX,
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
                    transition={DEFAULT_NODE_TRANSITION}
                    data-snapshot-entry={key}
                    data-snapshot-level={levelId.toString()}
                >
                    {overflowCount} more

                </motion.div>
            );
        }
    }
}

/// A function to render a catalog
export function renderCatalog(state: RenderingState, viewModel: CatalogViewModel): [RenderingState, RenderingOutput] {
    const ctx: RenderingContext = {
        viewModel,
        snapshot: viewModel.catalogSnapshot.read(),
        renderingEpoch: viewModel.nextRenderingEpoch++,
        latestFocusEpoch: viewModel.latestFocusEpoch,
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
        }
    };
    // Render the levels
    renderEntriesAtLevel(ctx, 0, 0, viewModel.databaseEntries.entries.length(ctx.snapshot), null, false);

    return [ctx.nextState, ctx.output];
}
