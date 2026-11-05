import * as React from 'react';
import type * as core from '@ankoh/dashql-core';
import { select, zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3';

import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { PlusIcon, SymbolIcon, ZoomInIcon, ZoomOutIcon } from '../../ui/foundations/symbol_icon.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { useQueryState } from '../../connections/query_executor.js';
import { VisualizationPanel } from '../../views/visualization/visualization_panel.js';
import { GraphPort } from '../../ui/graph/graph_port.js';
import * as graphStyles from '../../ui/graph/graph.module.css';
import type { ScriptData, SessionScripts } from '../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../scripts/script_types.js';
import { checkSessionScriptReferences } from '../scripts/script_reference_reports.js';
import type { ScriptReferenceReport } from '../scripts/script_reference_check.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import { ScriptEntryHeader } from '../feed/script_entry_header.js';
import { deriveDataflowGraph, DataflowEdgeKind, INPUT_PORT_SCRIPT_KEY, statementTypeLabel, type DataflowInput, type DataflowScript } from './dataflow_graph.js';
import { SessionInputCard } from '../inputs/session_input_card.js';
import { useApplySessionInput } from '../inputs/use_apply_session_input.js';
import { deriveSessionInputs, type SessionInput } from '../inputs/session_inputs.js';
import {
    buildDataflowScene,
    dataflowRouteKey,
    nodeKeyOfInput,
    nodeKeyOfScript,
    type DataflowHint,
    type DataflowLaidOutRoute,
    type DataflowRouting,
    dataflowLayoutInput,
    EDGE_BADGE_HEIGHT,
    fitDataflowScene,
    resizeDataflowBox,
    selectedEdges,
    type DataflowBoxPosition,
    type DataflowBoxSize,
    type DataflowSceneBox,
    type DataflowSceneEdge,
    type DataflowSceneInput,
    type DataflowSelection,
} from './dataflow_scene.js';
import { createFlowScript, deleteFlowScript, persistFlowPlacement, removeFlowPositions } from './dataflow_source.js';
import { useDataflowModule } from './dataflow_module.js';
import { QueryStatusPlaceholder } from '../../views/card_placeholder.js';
import * as styles from './dataflow.module.css';

const FitIcon = SymbolIcon('graph_align');

/// The approximate width of a character of a statement label, labels are truncated to the box
const LABEL_CHAR_WIDTH = 8;
/// The border of the frame of a chart, see `.chart_body`
const CHART_BORDER = 1;
/// The resize handle in the bottom right corner of a box, and the step of a resize with the arrow keys
const RESIZE_HANDLE = 16;
const RESIZE_KEY_STEP = 16;
/// The canvas draws every box with its statements
const NEVER_COLLAPSED = () => false;

export interface DataflowCanvasDependencies {
    useQueryState: typeof useQueryState;
    VisualizationPanel: typeof VisualizationPanel;
    useDataflowModule: typeof useDataflowModule;
    ScriptEntryHeader: typeof ScriptEntryHeader;
}

const DEFAULT_DEPENDENCIES: DataflowCanvasDependencies = {
    useQueryState,
    VisualizationPanel,
    useDataflowModule,
    ScriptEntryHeader,
};

const NO_CONNECTIONS: ReadonlyMap<string, ConnectionState> = new Map();

interface Props {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// The connections that the scripts run on, the headers of the boxes show and pick them
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    /// The function that renames the references in the draft of the composer
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// Open the script in the editor dialog
    onInspect?: (scriptKey: number) => void;
    dependencies?: DataflowCanvasDependencies;
}

interface Position {
    x: number;
    y: number;
}

/// The size of a box during a resize: its width and the height of its chart, null without a chart
interface ResizedBox {
    width: number;
    chartHeight: number | null;
}

/// The input or the script of the key of a box (`nodeKeyOfInput`, `nodeKeyOfScript`)
function inputOfNodeKey(key: string): string | null {
    return key.startsWith('input:') ? key.slice('input:'.length) : null;
}

function scriptOfNodeKey(key: string): number {
    return Number(key.slice('script:'.length));
}

/// Snap a size to the grid, within its bounds
function snapSize(value: number, min: number, max: number, grid: number): number {
    return Math.min(max, Math.max(min, Math.round(value / grid) * grid));
}

function truncate(text: string, length: number): string {
    return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

/// The dataflow of a session: every script is a box of its statements, edges show the flow of data between them.
/// The core lays the boxes out with ELK and routes the edges. Every layout starts from where the boxes were, so
/// boxes keep their columns, their order in a column and their y while the scripts are edited. A dropped or resized
/// box makes the others move as little as possible, then every box is saved in the `@flow` tag of its script, so a
/// reload shows the same layout. Arrange lays out every box anew.
export function DataflowCanvas(props: Props): React.ReactElement {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    // The layout is a wasm module of its own, loaded with the first canvas
    const { layout, error } = dependencies.useDataflowModule();
    if (layout == null) {
        return (
            <div className={styles.viewport} data-testid="dataflow-loading">
                <div className={styles.empty}>{error != null ? `Eclipse Layout Kernel failed to load: ${error.message}` : 'Loading Eclipse Layout Kernel…'}</div>
            </div>
        );
    }
    return <DataflowCanvasView {...props} dependencies={dependencies} layoutModule={layout} />;
}

function DataflowCanvasView(props: Props & { dependencies: DataflowCanvasDependencies; layoutModule: core.DashQLDataflow }): React.ReactElement {
    const { sessionScripts, modifySessionScripts, dependencies, layoutModule } = props;
    // The sizes of the canvas, set by the layout
    const config = layoutModule.config;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const sceneRef = React.useRef<SVGGElement | null>(null);
    const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const transformRef = React.useRef<ZoomTransform>(zoomIdentity);
    const [selection, setSelection] = React.useState<DataflowSelection | null>(null);
    const [hover, setHover] = React.useState<DataflowSelection | null>(null);
    const [drag, setDrag] = React.useState<{ node: string; position: Position } | null>(null);
    const [resize, setResize] = React.useState<{ scriptKey: number; size: ResizedBox } | null>(null);
    const [arrangeRevision, setArrangeRevision] = React.useState(0);

    // Where the layout placed the boxes without `@flow` tags, by script key. The boxes keep these positions while
    // the session changes, so that only new boxes are placed. A box that a growing neighbour would overlap is placed
    // again, a tag always wins.
    const placedRef = React.useRef(new Map<number, Position>());
    // Where the layout or a drag placed the inputs, by name. No script holds the position of an input.
    const placedInputsRef = React.useRef(new Map<string, Position>());
    // A drop or a resize that waits for its layout: the dropped box and where it was dropped, or the resized script
    // and its size. The layout after it is saved.
    const commitRef = React.useRef<{ node: string; position: Position | null; size: ResizedBox | null } | null>(null);
    // Arrange lays out every box anew
    const arrangingRef = React.useRef(false);
    const { apply: applyInput, literalOf, busyInputs } = useApplySessionInput(sessionScripts, modifySessionScripts);

    const graph = deriveDataflowGraph(sessionScripts);
    const scriptOf = React.useCallback((script: DataflowScript): ScriptData | undefined => sessionScripts.scripts[script.scriptKey], [sessionScripts.scripts]);
    const chartStatement = React.useCallback((script: DataflowScript) => {
        const statementId = scriptOf(script)?.annotations.visualizeQuery?.statementId;
        return statementId != null && statementId < script.statements.length ? statementId : null;
    }, [scriptOf]);

    // Every box is laid out from where it was: where the last layout put it, else where its `@flow` tag saved it. A
    // dropped box is laid out from where it was dropped, a resized one with its new size. ELK keeps the columns, the
    // order in a column and the y of the boxes, and routes the edges between them.
    const layout = React.useMemo((): { boxes: DataflowBoxPosition[]; laidOut: ReadonlyMap<string, DataflowLaidOutRoute> } => {
        const placed = placedRef.current;
        const placedInputs = placedInputsRef.current;
        const commit = commitRef.current;
        const arranging = arrangingRef.current;
        arrangingRef.current = false;
        const tagOf = (script: DataflowScript): Position | null => {
            if (arranging) return null;
            const flow = scriptOf(script)?.annotations.flowPosition;
            return flow?.x != null && flow.y != null ? { x: flow.x, y: flow.y } : null;
        };
        const sizeOf = (script: DataflowScript): DataflowBoxSize | null => {
            const flow = scriptOf(script)?.annotations.flowPosition;
            if (commit?.size != null && commit.node === nodeKeyOfScript(script.scriptKey)) {
                return { width: commit.size.width, chartHeight: commit.size.chartHeight ?? flow?.height ?? null };
            }
            return flow != null ? { width: flow.width, chartHeight: flow.height } : null;
        };
        const hintOf = (key: string, last: Position | undefined, saved: Position | null): DataflowHint | null => {
            if (commit?.position != null && commit.node === key) return { ...commit.position, dropped: true };
            const at = last ?? saved;
            return at == null ? null : { x: at.x, y: at.y };
        };
        if (graph.scripts.length === 0) return { boxes: [], laidOut: new Map() };
        const keys = [...graph.scripts.map(script => nodeKeyOfScript(script.scriptKey)), ...graph.inputs.map(input => nodeKeyOfInput(input.name))];
        const input = dataflowLayoutInput(
            graph,
            script => hintOf(nodeKeyOfScript(script.scriptKey), placed.get(script.scriptKey), tagOf(script)),
            chartStatement,
            () => false,
            input => hintOf(nodeKeyOfInput(input.name), placedInputs.get(input.name), null),
            sizeOf,
        );
        const result = layoutModule.computeDataflowLayoutWithRoutes(input.boxes, input.edges);
        const boxes = result.boxes;
        const rect = (i: number) => ({ x: boxes[i].x, y: boxes[i].y, width: boxes[i].width, height: boxes[i].height });
        const laidOut = new Map(result.routes.map(r => [
            dataflowRouteKey(keys[r.fromBox], r.fromStatement, keys[r.toBox], r.toStatement),
            { from: rect(r.fromBox), to: rect(r.toBox), points: r.points },
        ]));
        // Remember where the boxes of analyzed scripts are, a script without statements is placed again once it has some
        placed.clear();
        graph.scripts.forEach((script, i) => {
            if (script.statements.length > 0) placed.set(script.scriptKey, { x: boxes[i].x, y: boxes[i].y });
        });
        placedInputs.clear();
        graph.inputs.forEach((input, i) => {
            const p = boxes[graph.scripts.length + i];
            if (p != null) placedInputs.set(input.name, { x: p.x, y: p.y });
        });
        return { boxes, laidOut };
    }, [graph, scriptOf, chartStatement, arrangeRevision, layoutModule]);
    const positions = layout.boxes;

    // After a drop or a resize, every script box is saved in its `@flow` tag: a reload lays out from there and shows
    // the same layout. Tags that already hold the position and the size stay.
    React.useEffect(() => {
        const commit = commitRef.current;
        if (commit == null) return;
        commitRef.current = null;
        graph.scripts.forEach((s, i) => {
            const script = sessionScripts.scripts[s.scriptKey];
            const p = positions[i];
            if (script == null || p == null || s.statements.length === 0) return;
            const flow = script.annotations.flowPosition;
            const resized = commit.size != null && commit.node === nodeKeyOfScript(s.scriptKey) ? commit.size : null;
            const width = resized != null ? resized.width : flow?.width ?? null;
            const height = resized != null ? resized.chartHeight ?? flow?.height ?? null : flow?.height ?? null;
            persistFlowPlacement(script, { x: p.x, y: p.y }, width, height, modifySessionScripts);
        });
    }, [positions]);

    // A dragged box follows the pointer, a resized box takes the size of the pointer. The other boxes make room once
    // the size is written.
    const shown = React.useMemo(() => {
        if (drag == null && resize == null) return positions;
        const out = positions.slice();
        if (drag != null) {
            const scriptIndex = graph.scripts.findIndex(s => nodeKeyOfScript(s.scriptKey) === drag.node);
            const inputIndex = graph.inputs.findIndex(i => nodeKeyOfInput(i.name) === drag.node);
            const index = scriptIndex >= 0 ? scriptIndex : inputIndex >= 0 ? graph.scripts.length + inputIndex : -1;
            if (index >= 0 && out[index] != null) out[index] = { ...out[index], x: drag.position.x, y: drag.position.y };
        }
        if (resize != null) {
            const index = graph.scripts.findIndex(s => s.scriptKey === resize.scriptKey);
            if (index >= 0 && out[index] != null) {
                out[index] = resizeDataflowBox(out[index], chartStatement(graph.scripts[index]), resize.size.width, resize.size.chartHeight, config);
            }
        }
        return out;
    }, [positions, drag, resize, graph.scripts, graph.inputs, chartStatement]);
    // The edges between boxes go around the other boxes, routed by the core
    // Edges follow the routes of the layout, the edges of a dragged or resized box are routed around the boxes
    const routing: DataflowRouting = React.useMemo(
        () => ({ laidOut: layout.laidOut, route: (boxes, edges) => layoutModule.routeDataflowEdges(boxes, edges) }),
        [layout, layoutModule],
    );
    const scene = React.useMemo(() => buildDataflowScene(graph, shown, chartStatement, NEVER_COLLAPSED, config, routing), [graph, shown, chartStatement, routing]);
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
            // A pinch on a touchpad is a wheel with ctrlKey and zooms the canvas over the rows and charts too
            .filter(event => (event.type === 'wheel' && event.ctrlKey) || (!event.ctrlKey && !event.button
                && !(event.target instanceof Element && event.target.closest('button, [role="button"], foreignObject'))))
            .on('zoom', event => {
                transformRef.current = event.transform;
                sceneRef.current?.setAttribute('transform', event.transform.toString());
            });
        zoomRef.current = behavior;
        select(svg).call(behavior).on('dblclick.zoom', null);
        return () => {
            select(svg).on('.zoom', null);
            zoomRef.current = null;
        };
    }, []);
    // A pinch never zooms the page while the canvas is open, wherever the pointer is.
    // Chromium sends a pinch as a wheel with ctrlKey, Safari as gesture events.
    React.useEffect(() => {
        const prevent = (event: Event) => {
            if (event.type !== 'wheel' || (event as WheelEvent).ctrlKey) event.preventDefault();
        };
        const options = { capture: true, passive: false };
        document.addEventListener('wheel', prevent, options);
        document.addEventListener('gesturestart', prevent, options);
        document.addEventListener('gesturechange', prevent, options);
        return () => {
            document.removeEventListener('wheel', prevent, options);
            document.removeEventListener('gesturestart', prevent, options);
            document.removeEventListener('gesturechange', prevent, options);
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
                commitRef.current = { node: current.node, position: current.position, size: null };
                setArrangeRevision(r => r + 1);
            }
            return;
        }
        const scriptKey = scriptOfNodeKey(current.node);
        if (current.position == null) {
            if (commit) setSelection({ scriptKey, statementId: null });
            return;
        }
        // The layout starts from where the box was dropped, then every box is saved
        if (commit) {
            commitRef.current = { node: current.node, position: current.position, size: null };
            setArrangeRevision(r => r + 1);
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
            const grid = config.grid;
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

    // Resizing a box by the handle in its bottom right corner: the width of the box and the height of its chart, a box
    // without a chart only changes its width. The size is written into the `@flow` tag of the script on release.
    const resizeRef = React.useRef<{ scriptKey: number; pointerId: number; startX: number; startY: number; origin: ResizedBox; size: ResizedBox } | null>(null);
    // The layout makes room for the new size, then every box is saved with it
    const writeSize = React.useCallback((scriptKey: number, size: ResizedBox) => {
        commitRef.current = { node: nodeKeyOfScript(scriptKey), position: null, size };
        setArrangeRevision(r => r + 1);
    }, []);
    const finishResizeRef = React.useRef<(event: PointerEvent, commit: boolean) => void>(() => {});
    finishResizeRef.current = (event: PointerEvent, commit: boolean) => {
        const current = resizeRef.current;
        if (current == null || current.pointerId !== event.pointerId) return;
        resizeRef.current = null;
        setResize(null);
        const { size, origin } = current;
        if (commit && (size.width !== origin.width || size.chartHeight !== origin.chartHeight)) writeSize(current.scriptKey, size);
    };
    React.useEffect(() => {
        const move = (event: PointerEvent) => {
            const current = resizeRef.current;
            if (current == null || current.pointerId !== event.pointerId) return;
            const k = transformRef.current.k;
            const width = snapSize(current.origin.width + (event.clientX - current.startX) / k, config.minBoxWidth, config.maxBoxWidth, config.grid);
            const chartHeight = current.origin.chartHeight == null
                ? null
                : snapSize(current.origin.chartHeight + (event.clientY - current.startY) / k, config.minChartHeight, config.maxChartHeight, config.grid);
            if (width === current.size.width && chartHeight === current.size.chartHeight) return;
            current.size = { width, chartHeight };
            setResize({ scriptKey: current.scriptKey, size: current.size });
        };
        const up = (event: PointerEvent) => finishResizeRef.current(event, true);
        const cancel = (event: PointerEvent) => finishResizeRef.current(event, false);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        return () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', cancel);
        };
    }, []);
    const onResizeDown = React.useCallback((event: React.PointerEvent, box: DataflowSceneBox) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const origin = { width: box.width, chartHeight: box.chart?.height ?? null };
        resizeRef.current = { scriptKey: box.script.scriptKey, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, size: origin };
    }, []);
    const onResizeKey = React.useCallback((event: React.KeyboardEvent, box: DataflowSceneBox) => {
        let width = box.width;
        let chartHeight = box.chart?.height ?? null;
        if (event.key === 'ArrowLeft') width -= RESIZE_KEY_STEP;
        else if (event.key === 'ArrowRight') width += RESIZE_KEY_STEP;
        else if (event.key === 'ArrowUp' && chartHeight != null) chartHeight -= RESIZE_KEY_STEP;
        else if (event.key === 'ArrowDown' && chartHeight != null) chartHeight += RESIZE_KEY_STEP;
        else return;
        event.preventDefault();
        event.stopPropagation();
        const size = {
            width: snapSize(width, config.minBoxWidth, config.maxBoxWidth, config.grid),
            chartHeight: chartHeight == null ? null : snapSize(chartHeight, config.minChartHeight, config.maxChartHeight, config.grid),
        };
        // A box at a bound of its size stays as it is
        if (size.width === box.width && size.chartHeight === (box.chart?.height ?? null)) return;
        writeSize(box.script.scriptKey, size);
    }, [writeSize]);

    // Creating and removing scripts
    const deleteScript = React.useCallback((script: ScriptData) => deleteFlowScript(script, modifySessionScripts), [modifySessionScripts]);
    // The headers of the boxes show the diagnostics of the script references like the feed
    const scriptReferences = React.useMemo(() => checkSessionScriptReferences(sessionScripts), [sessionScripts]);
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
        const grid = config.grid;
        createAt({ x: Math.round(x / grid) * grid, y: Math.round(y / grid) * grid }, null);
    }, [createAt]);
    const arrange = React.useCallback(() => {
        placedRef.current.clear();
        placedInputsRef.current.clear();
        // The tags are removed with the next analysis, the next layout ignores them already
        arrangingRef.current = true;
        const scripts = graph.scripts.map(scriptOf).filter((s): s is ScriptData => s != null);
        removeFlowPositions(scripts, modifySessionScripts);
        setArrangeRevision(r => r + 1);
        fittedRef.current = false;
    }, [graph.scripts, scriptOf, modifySessionScripts]);

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
                    {/* The outlines of the boxes, below every edge */}
                    <g>
                        {scene.boxes.map(box => (
                            <rect
                                key={box.script.scriptKey}
                                className={styles.card}
                                data-dataflow-card={box.script.scriptKey}
                                // A selected box outlines the whole card, not its header
                                data-selected={selection?.scriptKey === box.script.scriptKey && selection.statementId == null && selection.input == null}
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
                                data-selected={selection?.input === box.input.name}
                                x={box.x}
                                y={box.y}
                                width={box.width}
                                height={box.height}
                                rx={8}
                                ry={8}
                            />
                        ))}
                    </g>
                    {/* The edges between boxes run on the outlines up to their ports, the layout routes them around the boxes */}
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
                    {/* The edges between the rows of a box run inside its padding */}
                    <g aria-hidden="true">
                        {internal.map(edge => (
                            <path key={edge.key} className={graphStyles.edge} d={edge.path} style={{ strokeWidth: 2 }} data-dataflow-edge={edge.key} data-kind={edge.kind} />
                        ))}
                    </g>
                    <g>
                        {scene.boxes.map(box => (
                            <DataflowBox
                                config={config}
                                key={box.script.scriptKey}
                                box={box}
                                sessionScripts={sessionScripts}
                                modifySessionScripts={modifySessionScripts}
                                scriptConnections={props.scriptConnections ?? NO_CONNECTIONS}
                                scriptReferences={scriptReferences.get(box.script.scriptKey) ?? null}
                                draftRenameRef={props.draftRenameRef}
                                script={sessionScripts.scripts[box.script.scriptKey]}
                                selection={selection?.scriptKey === box.script.scriptKey ? selection : null}
                                dragging={drag?.node === nodeKeyOfScript(box.script.scriptKey)}
                                resizing={resize?.scriptKey === box.script.scriptKey}
                                dependencies={dependencies}
                                onHandleDown={onHandleDown}
                                onResizeDown={onResizeDown}
                                onResizeKey={onResizeKey}
                                onSelect={setSelection}
                                onHover={setHover}
                                onInspect={props.onInspect}
                                onDelete={deleteScript}
                                onCreateDownstream={createDownstream}
                            />
                        ))}
                        {scene.inputs.map(box => (
                            <DataflowInputBox
                                config={config}
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
                        {scene.boxes.map(box => <DataflowBoxPorts key={box.script.scriptKey} box={box} highlighted={highlighted} config={config} />)}
                        {scene.inputs.map(box => (
                            <DataflowInputPorts
                                key={box.input.name}
                                box={box}
                                config={config}
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
    config: core.DataflowLayoutConfig;
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    scriptReferences: ScriptReferenceReport | null;
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    script: ScriptData | undefined;
    selection: DataflowSelection | null;
    dragging: boolean;
    resizing: boolean;
    dependencies: DataflowCanvasDependencies;
    onHandleDown: (event: React.PointerEvent, box: DataflowSceneBox) => void;
    onResizeDown: (event: React.PointerEvent, box: DataflowSceneBox) => void;
    onResizeKey: (event: React.KeyboardEvent, box: DataflowSceneBox) => void;
    onSelect: (selection: DataflowSelection) => void;
    /// The pointer enters a box with its selection or leaves it with null
    onHover: (selection: DataflowSelection | null) => void;
    onInspect?: (scriptKey: number) => void;
    onDelete: (script: ScriptData) => void;
    onCreateDownstream: (box: DataflowSceneBox) => void;
}

/// The ports of a script box: one per side of a collapsed box, the ports of the statement rows otherwise
function DataflowBoxPorts(props: { box: DataflowSceneBox; highlighted: DataflowSceneEdge[]; config: core.DataflowLayoutConfig }): React.ReactElement {
    const { box } = props;
    const config = props.config;
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

/// The output port of an input box, on its value row
function DataflowInputPorts(props: { box: DataflowSceneInput; highlighted: boolean; config: core.DataflowLayoutConfig }): React.ReactElement | null {
    const { box } = props;
    const config = props.config;
    if (!box.output) return null;
    const y = box.rowY + config.rowHeight / 2;
    const x = box.x + box.width - config.rowPadding;
    return <GraphPort x={x} y={y} side="right" highlighted={props.highlighted} data-dataflow-port="output" />;
}

/// The controls in the header of a box, a pointer down on them does not drag the box
const HEADER_CONTROLS = 'button, input, textarea, select, a, [role="button"], [role="menuitem"], [contenteditable]';

/// Is a pointer event on the header itself, not on one of its controls or in a popover that the header portals?
function onHeaderItself(event: React.SyntheticEvent): boolean {
    const target = event.target as Element;
    return event.currentTarget.contains(target) && target.closest(HEADER_CONTROLS) == null;
}

/// A script box: the header of the feed entry of the script, the statement rows, and the chart. The ports are drawn
/// by `DataflowBoxPorts` in a layer of their own.
function DataflowBox(props: BoxProps): React.ReactElement {
    const { box, script } = props;
    const config = props.config;
    const sessionId = props.sessionScripts.sessionId;
    const query = props.dependencies.useQueryState(sessionId, script?.latestQueryId ?? null);
    const name = scriptDisplayName(box.script.fileName);
    const scriptKey = box.script.scriptKey;
    const terminal = box.rows.length - 1;
    const result = query?.resultTable;
    // A new script reads the whole script, so the add button sits at the vertical middle of the box
    const addY = box.y + box.height / 2;
    const labelChars = (badgeWidth: number) => Math.max(4, Math.floor((box.width - 2 * config.rowPadding - 16 - badgeWidth - 8) / LABEL_CHAR_WIDTH));
    // The box has no editor, the edit button of the header opens the script in the editor dialog
    const onInspect = props.onInspect;
    const edit = React.useCallback(() => onInspect?.(scriptKey), [onInspect, scriptKey]);
    return (
        <g
            className={styles.box}
            data-dataflow-box={scriptKey}
            data-selected={props.selection != null && props.selection.statementId == null}
            data-dragging={props.dragging || undefined}
            data-resizing={props.resizing || undefined}
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
            </g>
            {/* The header of the feed entry, a drag on its free space moves the box */}
            <foreignObject
                x={box.x}
                y={box.y}
                width={box.width}
                height={config.headerHeight}
                className={styles.header_object}
            >
                <div
                    className={styles.header_body}
                    data-dataflow-header={scriptKey}
                    onPointerDown={event => { if (onHeaderItself(event)) props.onHandleDown(event, box); }}
                    onDoubleClick={event => {
                        if (!onHeaderItself(event)) return;
                        event.stopPropagation();
                        props.onInspect?.(scriptKey);
                    }}
                >
                    <props.dependencies.ScriptEntryHeader
                        sessionScripts={props.sessionScripts}
                        modifySessionScripts={props.modifySessionScripts}
                        scriptKey={scriptKey}
                        scriptConnections={props.scriptConnections}
                        scriptReferences={props.scriptReferences}
                        draftRenameRef={props.draftRenameRef}
                        onDelete={props.onDelete}
                        onEdit={onInspect != null ? edit : undefined}
                        // The snippets show in the editor dialog, the box has no room for them
                        snippets={false}
                        className={styles.entry_header}
                    />
                </div>
            </foreignObject>
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
                            {truncate(row.statement.label, labelChars(badgeWidth))}
                        </text>
                    </g>
                );
            })}
            {box.chart != null && script?.annotations.visualizeQuery != null && (
                <foreignObject x={box.chart.x} y={box.chart.y} width={box.chart.width} height={box.chart.height} className={styles.chart}>
                    <div className={styles.chart_body}>
                        {query?.resultTable != null
                            ? <props.dependencies.VisualizationPanel
                                query={query}
                                visualizeQuery={script.annotations.visualizeQuery}
                                width={box.chart.width - 2 * CHART_BORDER}
                                height={box.chart.height - 2 * CHART_BORDER}
                                preview
                            />
                            : <QueryStatusPlaceholder query={query ?? null} />}
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
            {!box.collapsed && (
                <g
                    className={styles.resize_handle}
                    role="button"
                    tabIndex={0}
                    aria-label={box.chart != null
                        ? `Resize ${name}. Current width ${box.width}, chart height ${box.chart.height}`
                        : `Resize ${name}. Current width ${box.width}`}
                    data-dataflow-resize={scriptKey}
                    data-chart={box.chart != null || undefined}
                    transform={`translate(${box.x + box.width - RESIZE_HANDLE}, ${box.y + box.height - RESIZE_HANDLE})`}
                    onPointerDown={event => props.onResizeDown(event, box)}
                    onClick={event => event.stopPropagation()}
                    onKeyDown={event => props.onResizeKey(event, box)}
                >
                    <rect width={RESIZE_HANDLE} height={RESIZE_HANDLE} className={styles.resize_hit} />
                    <path d="M 12 6 V 12 H 6 Z" />
                </g>
            )}
        </g>
    );
}

interface InputBoxProps {
    box: DataflowSceneInput;
    config: core.DataflowLayoutConfig;
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
    const config = props.config;
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
                <text className={styles.title} x={box.x + 12} y={box.y + config.headerHeight / 2}>{truncate(`:${name}`, 16)}</text>
                <text className={styles.input_type} x={box.x + box.width - 12} y={box.y + config.headerHeight / 2} data-inferred={!input.type.cast || undefined}>
                    {truncate(input.type.sql, 14)}
                </text>
            </g>
            {props.input != null && (
                <foreignObject x={box.x + config.rowPadding} y={box.rowY} width={box.width - 2 * config.rowPadding} height={config.rowHeight} className={styles.input_row}>
                    <SessionInputCard input={props.input} variant="block" busy={props.busy} literalOf={props.literalOf} onCommit={props.onCommit} />
                </foreignObject>
            )}
        </g>
    );
}
