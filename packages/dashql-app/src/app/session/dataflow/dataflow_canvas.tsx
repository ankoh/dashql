import * as React from 'react';
import { select, zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3';

import { ButtonGroup } from '../../../ui/foundations/button_group.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, PlusIcon, SymbolIcon, TrashIcon, ZoomInIcon, ZoomOutIcon } from '../../../ui/foundations/symbol_icon.js';
import { useQueryState } from '../../connections/query_executor.js';
import { QueryExecutionStatus } from '../../../query/query_execution_state.js';
import { VisualizationDispatch } from '../compute/ui/visualization/visualization_dispatch.js';
import { GraphPort } from '../compute/ui/graph/graph_port.js';
import * as graphStyles from '../compute/ui/graph/graph.module.css';
import type { ScriptData, SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { deriveDataflowGraph, DataflowEdgeKind, statementTypeLabel, type DataflowScript } from './dataflow_graph.js';
import {
    buildDataflowScene,
    DATAFLOW_COLLAPSE_SCALE,
    DATAFLOW_LAYOUT,
    dataflowLayoutInput,
    EDGE_BADGE_HEIGHT,
    fitDataflowScene,
    selectedEdges,
    type DataflowBoxPosition,
    type DataflowSceneBox,
    type DataflowSceneEdge,
    type DataflowSelection,
} from './dataflow_scene.js';
import { createFlowScript, deleteFlowScript, persistFlowPosition, removeFlowPositions } from './dataflow_source.js';
import * as styles from './dataflow.module.css';

const FitIcon = SymbolIcon('graph_align');

/// The longest label of a statement row
const MAX_LABEL_CHARS = 30;
/// The size of the icons of a box header
const HEADER_ICON = 12;

export interface DataflowCanvasDependencies {
    useQueryState: typeof useQueryState;
    VisualizationDispatch: typeof VisualizationDispatch;
}

const DEFAULT_DEPENDENCIES: DataflowCanvasDependencies = {
    useQueryState,
    VisualizationDispatch,
};

interface Props {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// Open the script in the inspector
    onInspect?: (scriptKey: number) => void;
    dependencies?: DataflowCanvasDependencies;
}

interface Position {
    x: number;
    y: number;
}

function samePosition(l: Position | null | undefined, r: Position | null | undefined): boolean {
    return l == null ? r == null : r != null && l.x === r.x && l.y === r.y;
}

function truncate(text: string, length: number): string {
    return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/// The dataflow of a session: every script is a box of its statements, edges show the flow of data between them.
/// The boxes keep the positions of their `@vis flow` tags, the others are placed by the layout of the core. A box
/// that was placed keeps its position while the scripts are edited, Arrange lays out every box again.
export function DataflowCanvas(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { sessionScripts, modifySessionScripts } = props;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const sceneRef = React.useRef<SVGGElement | null>(null);
    const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const transformRef = React.useRef<ZoomTransform>(zoomIdentity);
    const [zoomCollapsed, setZoomCollapsed] = React.useState(false);
    const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(new Set());
    const [selection, setSelection] = React.useState<DataflowSelection | null>(null);
    const [drag, setDrag] = React.useState<{ scriptKey: number; position: Position } | null>(null);
    const [arrangeRevision, setArrangeRevision] = React.useState(0);

    // The positions on screen, by script key, and the last `@vis flow` tags that were seen. A changed tag moves its
    // box, a box without a tag keeps where the layout put it.
    const placedRef = React.useRef(new Map<number, Position>());
    const tagsRef = React.useRef(new Map<number, Position | null>());

    const graph = deriveDataflowGraph(sessionScripts);
    const scriptOf = React.useCallback((script: DataflowScript): ScriptData | undefined => sessionScripts.scripts[script.scriptKey], [sessionScripts.scripts]);
    const isCollapsed = React.useCallback((script: DataflowScript) => zoomCollapsed || collapsed.has(script.scriptKey), [zoomCollapsed, collapsed]);
    const chartStatement = React.useCallback((script: DataflowScript) => {
        const statementId = scriptOf(script)?.annotations.visualizeQuery?.statementId;
        return statementId != null && statementId < script.statements.length ? statementId : null;
    }, [scriptOf]);
    const tagsSignature = graph.scripts.map(s => {
        const tag = scriptOf(s)?.annotations.flowPosition;
        return tag == null ? '' : `${tag.x},${tag.y}`;
    }).join(';');

    const positions: DataflowBoxPosition[] = React.useMemo(() => {
        const placed = placedRef.current;
        const tags = tagsRef.current;
        for (const script of graph.scripts) {
            const flow = scriptOf(script)?.annotations.flowPosition;
            const tag = flow != null ? { x: flow.x, y: flow.y } : null;
            if (tag != null && !samePosition(tags.get(script.scriptKey), tag)) placed.set(script.scriptKey, tag);
            tags.set(script.scriptKey, tag);
        }
        const input = dataflowLayoutInput(graph, script => placed.get(script.scriptKey) ?? null, chartStatement, isCollapsed);
        if (input.boxes.length === 0) return [];
        const layout = sessionScripts.instance.computeDataflowLayout(input.boxes, input.edges, DATAFLOW_LAYOUT);
        graph.scripts.forEach((script, i) => placed.set(script.scriptKey, { x: layout[i].x, y: layout[i].y }));
        return layout;
        // tagsSignature stands for the tags that the callbacks read
    }, [graph, tagsSignature, chartStatement, isCollapsed, arrangeRevision, sessionScripts.instance]);

    // A dragged box follows the pointer
    const shown = React.useMemo(() => {
        if (drag == null) return positions;
        const index = graph.scripts.findIndex(s => s.scriptKey === drag.scriptKey);
        if (index < 0) return positions;
        const out = positions.slice();
        out[index] = { ...positions[index], x: drag.position.x, y: drag.position.y };
        return out;
    }, [positions, drag, graph.scripts]);
    const scene = React.useMemo(() => buildDataflowScene(graph, shown, chartStatement, isCollapsed), [graph, shown, chartStatement, isCollapsed]);
    const highlighted = React.useMemo(() => selectedEdges(scene, selection), [scene, selection]);
    const highlightedSet = React.useMemo(() => new Set(highlighted), [highlighted]);

    // Zoom and pan, the transform is applied to the DOM directly
    const fit = React.useCallback((animate = false) => {
        const viewport = viewportRef.current;
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (viewport == null || svg == null || behavior == null) return;
        const { x, y, scale } = fitDataflowScene(scene.bounds, viewport.clientWidth, viewport.clientHeight);
        const target = zoomIdentity.translate(x, y).scale(scale);
        (animate ? select(svg).transition().duration(160) : select(svg)).call(behavior.transform as any, target);
    }, [scene.bounds]);
    React.useLayoutEffect(() => {
        const svg = svgRef.current;
        if (svg == null) return;
        const behavior = zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 2])
            .clickDistance(4)
            .filter(event => !event.button && !(event.target instanceof Element && event.target.closest('button, [data-dataflow-handle], foreignObject')))
            .on('zoom', event => {
                transformRef.current = event.transform;
                sceneRef.current?.setAttribute('transform', event.transform.toString());
                setZoomCollapsed(event.transform.k < DATAFLOW_COLLAPSE_SCALE);
            });
        zoomRef.current = behavior;
        select(svg).call(behavior).on('dblclick.zoom', null);
        return () => {
            select(svg).on('.zoom', null);
            zoomRef.current = null;
        };
    }, []);
    // Fit once the first boxes are placed
    const fittedRef = React.useRef(false);
    React.useLayoutEffect(() => {
        if (fittedRef.current || scene.boxes.length === 0) return;
        fittedRef.current = true;
        fit();
    }, [fit, scene.boxes.length]);
    const zoomBy = React.useCallback((factor: number) => {
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (svg != null && behavior != null) select(svg).transition().duration(120).call(behavior.scaleBy, factor);
    }, []);

    // Dragging a box by its header. Moves and the release are followed on the window, the pointer leaves the header.
    const dragRef = React.useRef<{ scriptKey: number; pointerId: number; startX: number; startY: number; origin: Position; moved: boolean } | null>(null);
    const dragPositionRef = React.useRef(drag);
    dragPositionRef.current = drag;
    const finishDragRef = React.useRef<(event: PointerEvent, commit: boolean) => void>(() => {});
    finishDragRef.current = (event: PointerEvent, commit: boolean) => {
        const current = dragRef.current;
        if (current == null || current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        const dropped = dragPositionRef.current;
        if (!current.moved || dropped == null) {
            if (commit) setSelection({ scriptKey: current.scriptKey, statementId: null });
            return;
        }
        setDrag(null);
        if (!commit) return;
        placedRef.current.set(current.scriptKey, dropped.position);
        const script = sessionScripts.scripts[current.scriptKey];
        if (script != null) persistFlowPosition(script, dropped.position.x, dropped.position.y, modifySessionScripts);
    };
    React.useEffect(() => {
        const move = (event: PointerEvent) => {
            const current = dragRef.current;
            if (current == null || current.pointerId !== event.pointerId) return;
            const k = transformRef.current.k;
            const dx = (event.clientX - current.startX) / k;
            const dy = (event.clientY - current.startY) / k;
            if (!current.moved && Math.hypot(dx * k, dy * k) < 4) return;
            current.moved = true;
            const grid = DATAFLOW_LAYOUT.grid;
            setDrag({ scriptKey: current.scriptKey, position: { x: Math.round((current.origin.x + dx) / grid) * grid, y: Math.round((current.origin.y + dy) / grid) * grid } });
        };
        const up = (event: PointerEvent) => finishDragRef.current(event, true);
        const cancel = (event: PointerEvent) => finishDragRef.current(event, false);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, []);
    const onHandleDown = React.useCallback((event: React.PointerEvent, box: DataflowSceneBox) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        dragRef.current = { scriptKey: box.script.scriptKey, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { x: box.x, y: box.y }, moved: false };
    }, []);

    // Creating and removing scripts
    const quoteIdentifier = React.useCallback((name: string) => sessionScripts.instance.quoteIdentifier(name), [sessionScripts.instance]);
    const createAt = React.useCallback((position: Position, producer: ScriptData | null) => {
        void createFlowScript(position.x, position.y, producer, quoteIdentifier, modifySessionScripts);
    }, [quoteIdentifier, modifySessionScripts]);
    const createDownstream = React.useCallback((box: DataflowSceneBox) => {
        const producer = sessionScripts.scripts[box.script.scriptKey] ?? null;
        createAt({ x: box.x + box.width + DATAFLOW_LAYOUT.layerGap, y: box.y }, producer);
    }, [sessionScripts.scripts, createAt]);
    const createNew = React.useCallback(() => {
        const bounds = scene.bounds;
        createAt({ x: bounds.x, y: scene.boxes.length === 0 ? 0 : bounds.y + bounds.height + DATAFLOW_LAYOUT.boxGap * 2 }, null);
    }, [scene.bounds, scene.boxes.length, createAt]);
    const onCanvasDoubleClick = React.useCallback((event: React.MouseEvent<SVGSVGElement>) => {
        if (event.target !== svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const [x, y] = transformRef.current.invert([event.clientX - rect.left, event.clientY - rect.top]);
        const grid = DATAFLOW_LAYOUT.grid;
        createAt({ x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid }, null);
    }, [createAt]);
    const arrange = React.useCallback(() => {
        placedRef.current.clear();
        const scripts = graph.scripts.map(scriptOf).filter((s): s is ScriptData => s != null);
        removeFlowPositions(scripts, modifySessionScripts);
        setArrangeRevision(r => r + 1);
        fittedRef.current = false;
    }, [graph.scripts, scriptOf, modifySessionScripts]);
    const toggleCollapsed = React.useCallback((scriptKey: number) => {
        setCollapsed(previous => {
            const next = new Set(previous);
            if (!next.delete(scriptKey)) next.add(scriptKey);
            return next;
        });
    }, []);

    const onKeyDown = React.useCallback((event: React.KeyboardEvent) => {
        if (event.target !== viewportRef.current) return;
        if (event.key === 'Escape') setSelection(null);
        else if (event.key === '+' || event.key === '=') zoomBy(1.25);
        else if (event.key === '-') zoomBy(0.8);
        else if (event.key === 'f') fit(true);
        else return;
        event.preventDefault();
        event.stopPropagation();
    }, [fit, zoomBy]);

    const internal = scene.edges.filter(e => e.internal);
    const between = scene.edges.filter(e => !e.internal);
    const solid = (e: DataflowSceneEdge) => e.kind === DataflowEdgeKind.Inline || e.kind === DataflowEdgeKind.Table;
    return (
        <div
            ref={viewportRef}
            className={styles.viewport}
            role="region"
            aria-label={`Dataflow of ${scene.boxes.length} scripts`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-testid="dataflow-canvas"
            data-electron-drag-region="false"
        >
            <svg
                ref={svgRef}
                className={styles.svg}
                onClick={event => { if (event.target === svgRef.current) setSelection(null); }}
                onDoubleClick={onCanvasDoubleClick}
            >
                <g ref={sceneRef}>
                    <g>
                        {scene.boxes.map(box => (
                            <rect
                                key={box.script.scriptKey}
                                className={graphStyles.fragment}
                                data-color={box.index % 6}
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                rx={8}
                                ry={8}
                            />
                        ))}
                    </g>
                    <g aria-hidden="true">
                        {between.filter(solid).concat(internal).map(edge => (
                            <path key={edge.key} className={graphStyles.edge} d={edge.path} style={{ strokeWidth: 2 }} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g aria-hidden="true">
                        {between.filter(e => !solid(e)).map(edge => (
                            <path key={edge.key} className={graphStyles.crossEdge} d={edge.path} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g className={graphStyles.edgeHighlightLayer} aria-hidden="true">
                        {highlighted.map(edge => (
                            <path
                                key={edge.key}
                                className={solid(edge) || edge.internal ? graphStyles.edgeHighlight : graphStyles.crossEdgeHighlight}
                                d={edge.path}
                                style={solid(edge) || edge.internal ? { strokeWidth: 2 } : undefined}
                                data-dataflow-edge-highlight={edge.key}
                            />
                        ))}
                    </g>
                    <g className={graphStyles.edgeBadgeLayer}>
                        {between.flatMap(edge => edge.badge == null ? [] : [(
                            <g
                                key={edge.key}
                                className={graphStyles.edgeBadge}
                                transform={`translate(${edge.badge.x}, ${edge.badge.y})`}
                                data-highlighted={highlightedSet.has(edge) || undefined}
                                data-dataflow-badge={edge.key}
                            >
                                <rect
                                    className={styles.badge}
                                    x={-edge.badge.width / 2}
                                    y={-EDGE_BADGE_HEIGHT / 2}
                                    width={edge.badge.width}
                                    height={EDGE_BADGE_HEIGHT}
                                    rx={EDGE_BADGE_HEIGHT / 2}
                                />
                                <text className={styles.badge_text}>{edge.badge.text}</text>
                            </g>
                        )])}
                    </g>
                    <g>
                        {scene.boxes.map(box => (
                            <DataflowBox
                                key={box.script.scriptKey}
                                box={box}
                                sessionId={sessionScripts.sessionId}
                                script={sessionScripts.scripts[box.script.scriptKey]}
                                selection={selection?.scriptKey === box.script.scriptKey ? selection : null}
                                highlighted={highlighted}
                                dragging={drag?.scriptKey === box.script.scriptKey}
                                dependencies={dependencies}
                                onHandleDown={onHandleDown}
                                onSelect={setSelection}
                                onToggleCollapsed={toggleCollapsed}
                                onInspect={props.onInspect}
                                onDelete={script => deleteFlowScript(script, modifySessionScripts)}
                                onCreateDownstream={createDownstream}
                            />
                        ))}
                    </g>
                </g>
            </svg>
            {scene.boxes.length === 0 && (
                <div className={styles.empty}>The scripts of the session appear here, double-click to add one.</div>
            )}
            <div className={styles.toolbar}>
                <Button size={ButtonSize.Small} variant={ButtonVariant.Default} leadingVisual={PlusIcon} onClick={createNew} data-testid="dataflow-new-script">New script</Button>
                <Button size={ButtonSize.Small} variant={ButtonVariant.Default} onClick={arrange} data-testid="dataflow-arrange">Arrange</Button>
            </div>
            <ButtonGroup className={styles.controls} aria-label="Dataflow zoom controls">
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><ZoomInIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom out" onClick={() => zoomBy(0.8)}><ZoomOutIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Fit dataflow" onClick={() => fit(true)}><FitIcon size={12} /></IconButton>
            </ButtonGroup>
        </div>
    );
}

interface BoxProps {
    box: DataflowSceneBox;
    sessionId: string;
    script: ScriptData | undefined;
    selection: DataflowSelection | null;
    highlighted: DataflowSceneEdge[];
    dragging: boolean;
    dependencies: DataflowCanvasDependencies;
    onHandleDown: (event: React.PointerEvent, box: DataflowSceneBox) => void;
    onSelect: (selection: DataflowSelection) => void;
    onToggleCollapsed: (scriptKey: number) => void;
    onInspect?: (scriptKey: number) => void;
    onDelete: (script: ScriptData) => void;
    onCreateDownstream: (box: DataflowSceneBox) => void;
}

/// The status of the last run of a script
function runStatus(status: QueryExecutionStatus | undefined): 'running' | 'succeeded' | 'failed' | 'idle' {
    if (status == null) return 'idle';
    if (status === QueryExecutionStatus.SUCCEEDED) return 'succeeded';
    if (status === QueryExecutionStatus.FAILED || status === QueryExecutionStatus.CANCELLED) return 'failed';
    return 'running';
}

/// A script box: the header with the name and the actions, the statement rows with their ports, and the chart
function DataflowBox(props: BoxProps): React.ReactElement {
    const { box, script } = props;
    const config = DATAFLOW_LAYOUT;
    const query = props.dependencies.useQueryState(props.sessionId, script?.latestQueryId ?? null);
    const status = runStatus(query?.status);
    const name = scriptDisplayName(box.script.fileName);
    const scriptKey = box.script.scriptKey;
    const touches = (statementId: number | null, side: 'from' | 'to') => props.highlighted.some(edge => {
        const port = edge[side];
        return port.scriptKey === scriptKey && (statementId == null || port.statementId === statementId);
    });
    const terminal = box.rows.length - 1;
    const result = query?.resultTable;
    const actions = [
        { key: 'collapse', label: box.collapsed ? `Expand ${name}` : `Collapse ${name}`, icon: box.collapsed ? ChevronRightIcon : ChevronDownIcon, run: () => props.onToggleCollapsed(scriptKey) },
        ...(props.onInspect != null ? [{ key: 'open', label: `Open ${name}`, icon: PencilIcon, run: () => props.onInspect!(scriptKey) }] : []),
        ...(script != null ? [{ key: 'delete', label: `Delete ${name}`, icon: TrashIcon, run: () => props.onDelete(script) }] : []),
    ];
    const outputY = box.collapsed || terminal < 0 ? box.y + config.headerHeight / 2 : box.rows[terminal].y + config.rowHeight / 2;
    return (
        <g
            className={styles.box}
            data-dataflow-box={scriptKey}
            data-selected={props.selection != null && props.selection.statementId == null}
            data-dragging={props.dragging || undefined}
        >
            <g
                className={styles.header}
                data-dataflow-handle
                role="button"
                tabIndex={0}
                aria-label={`${name}, ${box.rows.length} statements`}
                onPointerDown={event => props.onHandleDown(event, box)}
                onDoubleClick={event => { event.stopPropagation(); props.onInspect?.(scriptKey); }}
                onKeyDown={event => {
                    if (event.key === 'Enter') props.onInspect?.(scriptKey);
                    else if (event.key === ' ') props.onSelect({ scriptKey, statementId: null });
                    else return;
                    event.preventDefault();
                }}
            >
                <rect x={box.x} y={box.y} width={box.width} height={config.headerHeight} rx={8} ry={8} className={styles.header_hit} />
                <circle className={styles.status} data-status={status} cx={box.x + 14} cy={box.y + config.headerHeight / 2} r={4} />
                <text className={styles.title} x={box.x + 26} y={box.y + config.headerHeight / 2}>{truncate(name, 24)}</text>
            </g>
            {actions.map((action, i) => {
                const x = box.x + box.width - 8 - (actions.length - i) * (HEADER_ICON + 10);
                const Icon = action.icon;
                return (
                    <g
                        key={action.key}
                        className={styles.action}
                        role="button"
                        tabIndex={0}
                        aria-label={action.label}
                        data-dataflow-action={action.key}
                        transform={`translate(${x}, ${box.y + (config.headerHeight - HEADER_ICON) / 2})`}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => { event.stopPropagation(); action.run(); }}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            action.run();
                        }}
                    >
                        <rect x={-5} y={-5} width={HEADER_ICON + 10} height={HEADER_ICON + 10} rx={4} className={styles.action_hit} />
                        <Icon size={HEADER_ICON} />
                    </g>
                );
            })}
            {!box.collapsed && box.rows.map(row => {
                const id = row.statement.statementId;
                const selected = props.selection?.statementId === id;
                const badge = statementTypeLabel(row.statement.statementType);
                const badgeWidth = badge.length * 6 + 10;
                return (
                    <g
                        key={id}
                        className={styles.statement}
                        data-dataflow-statement={`${scriptKey}.${id}`}
                        data-selected={selected}
                        role="button"
                        tabIndex={0}
                        aria-label={`${badge} ${row.statement.label}`}
                        onClick={event => { event.stopPropagation(); props.onSelect({ scriptKey, statementId: id }); }}
                        onDoubleClick={event => { event.stopPropagation(); props.onInspect?.(scriptKey); }}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            props.onSelect({ scriptKey, statementId: id });
                        }}
                    >
                        <rect className={graphStyles.node_frame} x={box.x + config.rowPadding} y={row.y} width={box.width - 2 * config.rowPadding} height={config.rowHeight} rx={6} ry={6} />
                        <g className={styles.type_badge} transform={`translate(${box.x + config.rowPadding + 8}, ${row.y + config.rowHeight / 2})`}>
                            <rect x={0} y={-EDGE_BADGE_HEIGHT / 2} width={badgeWidth} height={EDGE_BADGE_HEIGHT} rx={EDGE_BADGE_HEIGHT / 2} />
                            <text x={badgeWidth / 2}>{badge}</text>
                        </g>
                        <text className={styles.label} x={box.x + config.rowPadding + 16 + badgeWidth} y={row.y + config.rowHeight / 2}>
                            {truncate(row.statement.label, MAX_LABEL_CHARS - badge.length)}
                        </text>
                        {row.input && <GraphPort x={box.x + config.rowPadding} y={row.y + config.rowHeight / 2} side="left" highlighted={touches(id, 'to')} data-dataflow-port="input" />}
                        {row.output && <GraphPort x={box.x + box.width - config.rowPadding} y={row.y + config.rowHeight / 2} side="right" highlighted={touches(id, 'from')} data-dataflow-port="output" />}
                    </g>
                );
            })}
            {box.collapsed && box.input && <GraphPort x={box.x} y={box.y + config.headerHeight / 2} side="left" highlighted={touches(null, 'to')} data-dataflow-port="input" />}
            {box.collapsed && box.output && <GraphPort x={box.x + box.width} y={box.y + config.headerHeight / 2} side="right" highlighted={touches(null, 'from')} data-dataflow-port="output" />}
            {box.chart != null && script?.annotations.visualizeQuery != null && (
                <foreignObject x={box.chart.x} y={box.chart.y} width={box.chart.width} height={box.chart.height} className={styles.chart}>
                    <div className={styles.chart_body}>
                        {query?.resultTable != null
                            ? <props.dependencies.VisualizationDispatch
                                query={query}
                                visualizeQuery={script.annotations.visualizeQuery}
                                width={box.chart.width}
                                height={box.chart.height}
                                hideLegend
                            />
                            : <div className={styles.chart_placeholder}>Run the script to see the chart</div>}
                    </div>
                </foreignObject>
            )}
            {!box.collapsed && box.chart == null && result != null && terminal >= 0 && (
                <text className={styles.summary} x={box.x + box.width - config.rowPadding - 10} y={box.rows[terminal].y + config.rowHeight / 2}>
                    {`${result.numRows} × ${result.numCols}`}
                </text>
            )}
            <g
                className={styles.add}
                role="button"
                tabIndex={0}
                aria-label={`Add a script that reads ${name}`}
                data-dataflow-action="add"
                transform={`translate(${box.x + box.width + 14}, ${outputY})`}
                onPointerDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); props.onCreateDownstream(box); }}
                onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    props.onCreateDownstream(box);
                }}
            >
                <circle r={8} />
                <path d="M -4 0 L 4 0 M 0 -4 L 0 4" />
            </g>
        </g>
    );
}
