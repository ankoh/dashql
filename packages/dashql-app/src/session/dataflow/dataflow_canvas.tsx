import * as React from 'react';
import { select, zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3';

import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, PlusIcon, SymbolIcon, TrashIcon, ZoomInIcon, ZoomOutIcon } from '../../ui/foundations/symbol_icon.js';
import { useQueryState } from '../../connections/query_executor.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { VisualizationDispatch } from '../../views/visualization/visualization_dispatch.js';
import { GraphPort } from '../../ui/graph/graph_port.js';
import * as graphStyles from '../../ui/graph/graph.module.css';
import type { ScriptData, SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { deriveDataflowGraph, DataflowEdgeKind, INPUT_PORT_SCRIPT_KEY, statementTypeLabel, type DataflowInput, type DataflowScript } from './dataflow_graph.js';
import { SessionInputCard } from '../inputs/session_input_card.js';
import { useApplySessionInput } from '../inputs/use_apply_session_input.js';
import { deriveSessionInputs, type SessionInput } from '../inputs/session_inputs.js';
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
    type DataflowSceneInput,
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

/// The key of the box of a script or of an input, the drag and the layout follow it
function nodeKeyOfScript(scriptKey: number): string {
    return `script:${scriptKey}`;
}

function nodeKeyOfInput(name: string): string {
    return `input:${name}`;
}

function inputOfNodeKey(key: string): string | null {
    return key.startsWith('input:') ? key.slice('input:'.length) : null;
}

function scriptOfNodeKey(key: string): number {
    return Number(key.slice('script:'.length));
}

/// Do two boxes overlap?
function boxesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function truncate(text: string, length: number): string {
    return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/// The dataflow of a session: every script is a box of its statements, edges show the flow of data between them.
/// The boxes keep the positions of their `@flow` tags, the others are placed by the layout of the core. A box
/// that was placed keeps its position while the scripts are edited, unless a neighbour grows over it, Arrange lays
/// out every box again.
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
    const [hover, setHover] = React.useState<DataflowSelection | null>(null);
    const [drag, setDrag] = React.useState<{ node: string; position: Position } | null>(null);
    const [arrangeRevision, setArrangeRevision] = React.useState(0);

    // Where the layout placed the boxes without `@flow` tags, by script key. The boxes keep these positions while
    // the session changes, so that only new boxes are placed. A box that a growing neighbour would overlap is placed
    // again, a tag always wins.
    const placedRef = React.useRef(new Map<number, Position>());
    // Where the layout or a drag placed the inputs, by name. No script holds the position of an input.
    const placedInputsRef = React.useRef(new Map<string, Position>());
    const { apply: applyInput, literalOf, busyInputs } = useApplySessionInput(sessionScripts, modifySessionScripts);

    const graph = deriveDataflowGraph(sessionScripts);
    const scriptOf = React.useCallback((script: DataflowScript): ScriptData | undefined => sessionScripts.scripts[script.scriptKey], [sessionScripts.scripts]);
    const isCollapsed = React.useCallback((script: DataflowScript) => zoomCollapsed || collapsed.has(script.scriptKey), [zoomCollapsed, collapsed]);
    const chartStatement = React.useCallback((script: DataflowScript) => {
        const statementId = scriptOf(script)?.annotations.visualizeQuery?.statementId;
        return statementId != null && statementId < script.statements.length ? statementId : null;
    }, [scriptOf]);

    // The layout lays out full boxes, collapsing a box only changes how it is drawn. The boxes of the inputs follow
    // the boxes of the scripts.
    const positions: DataflowBoxPosition[] = React.useMemo(() => {
        const placed = placedRef.current;
        const placedInputs = placedInputsRef.current;
        const tagOf = (script: DataflowScript): Position | null => {
            const flow = scriptOf(script)?.annotations.flowPosition;
            return flow != null ? { x: flow.x, y: flow.y } : null;
        };
        const keys = [...graph.scripts.map(script => nodeKeyOfScript(script.scriptKey)), ...graph.inputs.map(input => nodeKeyOfInput(input.name))];
        const isTagged = (i: number) => i < graph.scripts.length && tagOf(graph.scripts[i]) != null;
        const compute = (replace: ReadonlySet<string>) => {
            const soft = (key: string, position: Position | undefined) => (replace.has(key) ? null : position ?? null);
            const input = dataflowLayoutInput(
                graph,
                script => tagOf(script) ?? soft(nodeKeyOfScript(script.scriptKey), placed.get(script.scriptKey)),
                chartStatement,
                () => false,
                input => soft(nodeKeyOfInput(input.name), placedInputs.get(input.name)),
            );
            return sessionScripts.instance.computeDataflowLayout(input.boxes, input.edges, DATAFLOW_LAYOUT);
        };
        if (graph.scripts.length === 0) return [];
        let layout = compute(new Set());
        // A box that overlaps another one, e.g. one that grew, and was placed by the layout is placed again
        const replace = new Set<string>();
        for (let i = 0; i < layout.length; ++i) {
            for (let j = i + 1; j < layout.length; ++j) {
                if (!boxesOverlap(layout[i], layout[j])) continue;
                const soft = !isTagged(j) ? j : !isTagged(i) ? i : null;
                if (soft != null) replace.add(keys[soft]);
            }
        }
        if (replace.size > 0) layout = compute(replace);
        // Remember where the boxes of analyzed scripts are, a script without statements is placed again once it has some
        placed.clear();
        graph.scripts.forEach((script, i) => {
            if (tagOf(script) == null && script.statements.length > 0) placed.set(script.scriptKey, { x: layout[i].x, y: layout[i].y });
        });
        placedInputs.clear();
        graph.inputs.forEach((input, i) => {
            const p = layout[graph.scripts.length + i];
            if (p != null) placedInputs.set(input.name, { x: p.x, y: p.y });
        });
        return layout;
    }, [graph, scriptOf, chartStatement, arrangeRevision, sessionScripts.instance]);

    // A dragged box follows the pointer
    const shown = React.useMemo(() => {
        if (drag == null) return positions;
        const scriptIndex = graph.scripts.findIndex(s => nodeKeyOfScript(s.scriptKey) === drag.node);
        const inputIndex = graph.inputs.findIndex(i => nodeKeyOfInput(i.name) === drag.node);
        const index = scriptIndex >= 0 ? scriptIndex : inputIndex >= 0 ? graph.scripts.length + inputIndex : -1;
        if (index < 0 || positions[index] == null) return positions;
        const out = positions.slice();
        out[index] = { ...positions[index], x: drag.position.x, y: drag.position.y };
        return out;
    }, [positions, drag, graph.scripts, graph.inputs]);
    const scene = React.useMemo(() => buildDataflowScene(graph, shown, chartStatement, isCollapsed, DATAFLOW_LAYOUT, zoomCollapsed), [graph, shown, chartStatement, isCollapsed, zoomCollapsed]);
    // The edges of the selection and of the hovered box, a drag hides the ones of the hovered box
    const dragging = drag != null;
    const highlighted = React.useMemo(() => {
        const edges = new Set(selectedEdges(scene, selection));
        if (!dragging) for (const edge of selectedEdges(scene, hover)) edges.add(edge);
        return scene.edges.filter(edge => edges.has(edge));
    }, [scene, selection, hover, dragging]);
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
            .filter(event => (!event.ctrlKey || event.type === 'wheel') && !event.button
                && !(event.target instanceof Element && event.target.closest('button, [role="button"], foreignObject')))
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
    const dragRef = React.useRef<{ node: string; pointerId: number; startX: number; startY: number; origin: Position; position: Position | null } | null>(null);
    const finishDragRef = React.useRef<(event: PointerEvent, commit: boolean) => void>(() => {});
    finishDragRef.current = (event: PointerEvent, commit: boolean) => {
        const current = dragRef.current;
        if (current == null || current.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDrag(null);
        const input = inputOfNodeKey(current.node);
        if (input != null) {
            // An input keeps the position of the drag while the canvas is open
            if (current.position == null) {
                if (commit) setSelection({ scriptKey: INPUT_PORT_SCRIPT_KEY, statementId: null, input });
            } else if (commit) {
                placedInputsRef.current.set(input, current.position);
                setArrangeRevision(r => r + 1);
            }
            return;
        }
        const scriptKey = scriptOfNodeKey(current.node);
        if (current.position == null) {
            if (commit) setSelection({ scriptKey, statementId: null });
            return;
        }
        const script = sessionScripts.scripts[scriptKey];
        // The tag fixes the box, a script whose tag can't be written keeps its box where it was
        if (commit && script != null && persistFlowPosition(script, current.position.x, current.position.y, modifySessionScripts)) {
            placedRef.current.set(scriptKey, current.position);
        }
    };
    React.useEffect(() => {
        const move = (event: PointerEvent) => {
            const current = dragRef.current;
            if (current == null || current.pointerId !== event.pointerId) return;
            const k = transformRef.current.k;
            const dx = (event.clientX - current.startX) / k;
            const dy = (event.clientY - current.startY) / k;
            if (current.position == null && Math.hypot(dx * k, dy * k) < 4) return;
            const grid = DATAFLOW_LAYOUT.grid;
            current.position = { x: Math.round((current.origin.x + dx) / grid) * grid, y: Math.round((current.origin.y + dy) / grid) * grid };
            setDrag({ node: current.node, position: current.position });
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
        dragRef.current = { node: nodeKeyOfScript(box.script.scriptKey), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { x: box.x, y: box.y }, position: null };
    }, []);
    const onInputHandleDown = React.useCallback((event: React.PointerEvent, box: DataflowSceneInput) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        dragRef.current = { node: nodeKeyOfInput(box.input.name), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { x: box.x, y: box.y }, position: null };
    }, []);

    // Creating and removing scripts
    const quoteIdentifier = React.useCallback((name: string) => sessionScripts.instance.quoteIdentifier(name), [sessionScripts.instance]);
    const createAt = React.useCallback((position: Position | null, producer: ScriptData | null) => {
        void createFlowScript(position, producer, quoteIdentifier, modifySessionScripts);
    }, [quoteIdentifier, modifySessionScripts]);
    // The layout places a script that reads a box right of it, in a free slot
    const createDownstream = React.useCallback((box: DataflowSceneBox) => {
        createAt(null, sessionScripts.scripts[box.script.scriptKey] ?? null);
    }, [sessionScripts.scripts, createAt]);
    const createNew = React.useCallback(() => createAt(null, null), [createAt]);
    const onCanvasDoubleClick = React.useCallback((event: React.MouseEvent<SVGSVGElement>) => {
        if (event.target !== svgRef.current) return;
        const rect = svgRef.current.getBoundingClientRect();
        const [x, y] = transformRef.current.invert([event.clientX - rect.left, event.clientY - rect.top]);
        const grid = DATAFLOW_LAYOUT.grid;
        createAt({ x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid }, null);
    }, [createAt]);
    const arrange = React.useCallback(() => {
        placedRef.current.clear();
        placedInputsRef.current.clear();
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
    const solid = (e: DataflowSceneEdge) => e.kind === DataflowEdgeKind.Inline || e.kind === DataflowEdgeKind.Table || e.kind === DataflowEdgeKind.Input;
    const renderHighlight = (edge: DataflowSceneEdge) => (
        <path
            key={edge.key}
            className={solid(edge) || edge.internal ? graphStyles.edgeHighlight : graphStyles.crossEdgeHighlight}
            d={edge.path}
            style={solid(edge) || edge.internal ? { strokeWidth: 2 } : undefined}
            data-dataflow-edge-highlight={edge.key}
        />
    );
    const renderBadge = (edge: DataflowSceneEdge) => edge.badge == null ? null : (
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
    );
    // The inputs as the feed and the dashboard show them, with their warnings
    const sessionInputs = deriveSessionInputs(sessionScripts);
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
                    {/* The edges between boxes pass behind the cards */}
                    <g aria-hidden="true">
                        {between.filter(solid).map(edge => (
                            <path key={edge.key} className={graphStyles.edge} d={edge.path} style={{ strokeWidth: 2 }} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g aria-hidden="true">
                        {between.filter(e => !solid(e)).map(edge => (
                            <path key={edge.key} className={graphStyles.crossEdge} d={edge.path} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g className={graphStyles.edgeBadgeLayer}>
                        {between.filter(e => !highlightedSet.has(e)).map(renderBadge)}
                    </g>
                    <g>
                        {scene.boxes.map(box => (
                            <rect
                                key={box.script.scriptKey}
                                className={styles.card}
                                data-dataflow-card={box.script.scriptKey}
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                rx={8}
                                ry={8}
                            />
                        ))}
                        {scene.inputs.map(box => (
                            <rect
                                key={`input:${box.input.name}`}
                                className={styles.card}
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                rx={8}
                                ry={8}
                            />
                        ))}
                    </g>
                    {/* The edges between the rows of a box run inside its padding, on its card */}
                    <g aria-hidden="true">
                        {internal.map(edge => (
                            <path key={edge.key} className={graphStyles.edge} d={edge.path} style={{ strokeWidth: 2 }} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g>
                        {scene.boxes.map(box => (
                            <DataflowBox
                                key={box.script.scriptKey}
                                box={box}
                                sessionId={sessionScripts.sessionId}
                                script={sessionScripts.scripts[box.script.scriptKey]}
                                selection={selection?.scriptKey === box.script.scriptKey ? selection : null}
                                dragging={drag?.node === nodeKeyOfScript(box.script.scriptKey)}
                                dependencies={dependencies}
                                onHandleDown={onHandleDown}
                                onSelect={setSelection}
                                onHover={setHover}
                                onToggleCollapsed={toggleCollapsed}
                                onInspect={props.onInspect}
                                onDelete={script => deleteFlowScript(script, modifySessionScripts)}
                                onCreateDownstream={createDownstream}
                            />
                        ))}
                        {scene.inputs.map(box => (
                            <DataflowInputBox
                                key={box.input.name}
                                box={box}
                                input={sessionInputs.find(i => i.name === box.input.name) ?? null}
                                selected={selection?.input === box.input.name}
                                dragging={drag?.node === nodeKeyOfInput(box.input.name)}
                                busy={busyInputs.has(box.input.name)}
                                onHandleDown={onInputHandleDown}
                                onSelect={setSelection}
                                onHover={setHover}
                                literalOf={literalOf}
                                onCommit={applyInput}
                            />
                        ))}
                    </g>
                    {/* The highlighted edges and their badges are drawn on top of the boxes */}
                    <g className={graphStyles.edgeHighlightLayer} aria-hidden="true" data-dataflow-highlight-layer>
                        {highlighted.map(renderHighlight)}
                        {highlighted.filter(e => !e.internal).map(renderBadge)}
                    </g>
                    {/* The ports are drawn on top of the highlighted edges that end in them */}
                    <g aria-hidden="true" data-dataflow-port-layer>
                        {scene.boxes.map(box => <DataflowBoxPorts key={box.script.scriptKey} box={box} highlighted={highlighted} />)}
                        {scene.inputs.map(box => (
                            <DataflowInputPorts
                                key={box.input.name}
                                box={box}
                                highlighted={highlighted.length > 0 && highlighted.some(e => e.input === box.input.name)}
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
    dragging: boolean;
    dependencies: DataflowCanvasDependencies;
    onHandleDown: (event: React.PointerEvent, box: DataflowSceneBox) => void;
    onSelect: (selection: DataflowSelection) => void;
    /// The pointer enters a box with its selection or leaves it with null
    onHover: (selection: DataflowSelection | null) => void;
    onToggleCollapsed: (scriptKey: number) => void;
    onInspect?: (scriptKey: number) => void;
    onDelete: (script: ScriptData) => void;
    onCreateDownstream: (box: DataflowSceneBox) => void;
}

/// The ports of a script box: one per side of a collapsed box, the ports of the statement rows otherwise
function DataflowBoxPorts(props: { box: DataflowSceneBox; highlighted: DataflowSceneEdge[] }): React.ReactElement {
    const { box } = props;
    const config = DATAFLOW_LAYOUT;
    const scriptKey = box.script.scriptKey;
    const touches = (statementId: number | null, side: 'from' | 'to') => props.highlighted.some(edge => {
        const port = edge[side];
        return port.scriptKey === scriptKey && (statementId == null || port.statementId === statementId);
    });
    if (box.collapsed) {
        const y = box.y + config.headerHeight / 2;
        return (
            <g data-dataflow-ports={scriptKey}>
                {box.input && <GraphPort x={box.x} y={y} side="left" highlighted={touches(null, 'to')} data-dataflow-port="input" />}
                {box.output && <GraphPort x={box.x + box.width} y={y} side="right" highlighted={touches(null, 'from')} data-dataflow-port="output" />}
            </g>
        );
    }
    return (
        <g data-dataflow-ports={scriptKey}>
            {box.rows.map(row => {
                const id = row.statement.statementId;
                const y = row.y + config.rowHeight / 2;
                return (
                    <React.Fragment key={id}>
                        {row.input && <GraphPort x={box.x + config.rowPadding} y={y} side="left" highlighted={touches(id, 'to')} data-dataflow-port="input" />}
                        {row.output && <GraphPort x={box.x + box.width - config.rowPadding} y={y} side="right" highlighted={touches(id, 'from')} data-dataflow-port="output" />}
                    </React.Fragment>
                );
            })}
        </g>
    );
}

/// The output port of an input box, on its header when collapsed and on its value row otherwise
function DataflowInputPorts(props: { box: DataflowSceneInput; highlighted: boolean }): React.ReactElement | null {
    const { box } = props;
    const config = DATAFLOW_LAYOUT;
    if (!box.output) return null;
    const y = box.collapsed ? box.y + config.headerHeight / 2 : box.rowY + config.rowHeight / 2;
    const x = box.collapsed ? box.x + box.width : box.x + box.width - config.rowPadding;
    return <GraphPort x={x} y={y} side="right" highlighted={props.highlighted} data-dataflow-port="output" />;
}

/// The status of the last run of a script
function runStatus(status: QueryExecutionStatus | undefined): 'running' | 'succeeded' | 'failed' | 'idle' {
    if (status == null) return 'idle';
    if (status === QueryExecutionStatus.SUCCEEDED) return 'succeeded';
    if (status === QueryExecutionStatus.FAILED || status === QueryExecutionStatus.CANCELLED) return 'failed';
    return 'running';
}

/// A script box: the header with the name and the actions, the statement rows, and the chart. The ports are drawn
/// by `DataflowBoxPorts` in a layer of their own.
function DataflowBox(props: BoxProps): React.ReactElement {
    const { box, script } = props;
    const config = DATAFLOW_LAYOUT;
    const query = props.dependencies.useQueryState(props.sessionId, script?.latestQueryId ?? null);
    const status = runStatus(query?.status);
    const name = scriptDisplayName(box.script.fileName);
    const scriptKey = box.script.scriptKey;
    const terminal = box.rows.length - 1;
    const result = query?.resultTable;
    const actions = [
        { key: 'collapse', label: box.collapsed ? `Expand ${name}` : `Collapse ${name}`, icon: box.collapsed ? ChevronRightIcon : ChevronDownIcon, run: () => props.onToggleCollapsed(scriptKey) },
        ...(props.onInspect != null ? [{ key: 'open', label: `Open ${name}`, icon: PencilIcon, run: () => props.onInspect!(scriptKey) }] : []),
        ...(script != null ? [{ key: 'delete', label: `Delete ${name}`, icon: TrashIcon, run: () => props.onDelete(script) }] : []),
    ];
    // A new script reads the whole script, so the add button sits at the vertical middle of the box
    const addY = box.y + box.height / 2;
    return (
        <g
            className={styles.box}
            data-dataflow-box={scriptKey}
            data-selected={props.selection != null && props.selection.statementId == null}
            data-dragging={props.dragging || undefined}
            onPointerEnter={() => props.onHover({ scriptKey, statementId: null })}
            onPointerLeave={() => props.onHover(null)}
        >
            <rect className={styles.hover_hit} x={box.x} y={box.y} width={box.width} height={box.height} rx={8} ry={8} />
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
                    </g>
                );
            })}
            {box.chart != null && script?.annotations.visualizeQuery != null && (
                <foreignObject x={box.chart.x} y={box.chart.y} width={box.chart.width} height={box.chart.height} className={styles.chart}>
                    <div className={styles.chart_body}>
                        {query?.resultTable != null
                            ? <props.dependencies.VisualizationDispatch
                                query={query}
                                visualizeQuery={script.annotations.visualizeQuery}
                                width={box.chart.width}
                                height={box.chart.height}
                                preview
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
                transform={`translate(${box.x + box.width + 14}, ${addY})`}
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

interface InputBoxProps {
    box: DataflowSceneInput;
    /// The input of the session, null while the inputs follow the graph
    input: SessionInput | null;
    selected: boolean;
    dragging: boolean;
    busy: boolean;
    onHandleDown: (event: React.PointerEvent, box: DataflowSceneInput) => void;
    onSelect: (selection: DataflowSelection) => void;
    /// The pointer enters a box with its selection or leaves it with null
    onHover: (selection: DataflowSelection | null) => void;
    literalOf: (input: SessionInput, value: string) => { literal: string } | { error: string };
    onCommit: (name: string, literal: string) => void;
}

/// The box of an input: the header with the name and the type, and the value in its row. Enter in the value writes it
/// and runs the scripts that use the input.
function DataflowInputBox(props: InputBoxProps): React.ReactElement {
    const { box } = props;
    const config = DATAFLOW_LAYOUT;
    const input: DataflowInput = box.input;
    const name = input.name;
    const select = () => props.onSelect({ scriptKey: INPUT_PORT_SCRIPT_KEY, statementId: null, input: name });
    return (
        <g
            className={styles.box}
            data-dataflow-input={name}
            data-selected={props.selected}
            data-dragging={props.dragging || undefined}
            onPointerEnter={() => props.onHover({ scriptKey: INPUT_PORT_SCRIPT_KEY, statementId: null, input: name })}
            onPointerLeave={() => props.onHover(null)}
        >
            <rect className={styles.hover_hit} x={box.x} y={box.y} width={box.width} height={box.height} rx={8} ry={8} />
            <g
                className={styles.header}
                data-dataflow-handle
                role="button"
                tabIndex={0}
                aria-label={`Input :${name}, ${input.type.sql}`}
                onPointerDown={event => props.onHandleDown(event, box)}
                onKeyDown={event => {
                    if (event.key !== ' ' && event.key !== 'Enter') return;
                    event.preventDefault();
                    select();
                }}
            >
                <rect x={box.x} y={box.y} width={box.width} height={config.headerHeight} rx={8} ry={8} className={styles.header_hit} />
                <circle className={styles.status} data-status={props.busy ? 'running' : 'idle'} cx={box.x + 14} cy={box.y + config.headerHeight / 2} r={4} />
                <text className={styles.title} x={box.x + 26} y={box.y + config.headerHeight / 2}>{truncate(`:${name}`, 16)}</text>
                <text className={styles.input_type} x={box.x + box.width - 12} y={box.y + config.headerHeight / 2} data-inferred={!input.type.cast || undefined}>
                    {truncate(input.type.sql, 14)}
                </text>
            </g>
            {!box.collapsed && props.input != null && (
                <foreignObject x={box.x + config.rowPadding} y={box.rowY} width={box.width - 2 * config.rowPadding} height={config.rowHeight} className={styles.input_row}>
                    <SessionInputCard input={props.input} variant="block" busy={props.busy} literalOf={props.literalOf} onCommit={props.onCommit} />
                </foreignObject>
            )}
        </g>
    );
}
