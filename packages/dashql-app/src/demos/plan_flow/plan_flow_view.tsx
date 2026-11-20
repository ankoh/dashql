import * as React from 'react';
import * as dashql from '@akohn/dashql';
import { select, zoom, zoomIdentity, type ZoomBehavior } from 'd3';

import { ProfileExecutionState } from '@akohn/dashql/platform/query/profile_execution_state';
import { getProfileOperatorSymbol, PROFILE_OPERATOR_SYMBOL_SIZE, shouldRenderProfileOperatorSymbol } from '@akohn/dashql/platform/query/profile_operator_symbol';
import { materializeProfileScene, PROFILE_OPERATOR_PORT_INPUT, PROFILE_OPERATOR_PORT_OUTPUT, type ProfileScene, type ProfileSceneOperator } from '@akohn/dashql-react/components/query_profile/query_profile_view';
import { computeProfileFitTransform } from '@akohn/dashql-react/components/query_profile/query_profile_view';
import { formatCompactBytes, formatCompactCount, formatElapsed, stat, workOf } from '@akohn/dashql-react/format/query_progress_format';
import { GraphPort } from '@akohn/dashql-react/components/graph_port';
import { SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import * as graphStyles from '@akohn/dashql-react/components/graph.module.css';
import * as profileStyles from '@akohn/dashql-react/components/query_profile/query_profile_view.module.css';
import * as styles from './plan_flow_view.module.css';

const FIELD = dashql.buffers.profile.ProfileStatsField;
const STATUS = dashql.buffers.profile.ProfileExecutionStatus;
const NO_INDEX = 0xFFFFFFFF;

/// The edges are as thick as the log of their rows, from the thinnest to the most rows of the plan
const EDGE_MIN_WIDTH = 2;
const EDGE_MAX_WIDTH = 16;
const STATUS_ICON_SIZE = 14;
/// A long plan is not shrunk below this scale to fit, the labels would get too small
const MIN_READABLE_SCALE = 0.8;
const FIT_PADDING = 24;

/// The family of an operator, it colors the timeline and the sidebar
type OperatorCategory = 'scan' | 'join' | 'aggregate' | 'sort' | 'exchange' | 'other';

function categoryOf(kind: dashql.buffers.profile.ProfileOperatorKind): OperatorCategory {
    const name = dashql.buffers.profile.ProfileOperatorKind[kind] ?? '';
    if (/SCAN|VIRTUAL_TABLE|TABLE_FUNCTION|TABLE_CONSTRUCTION/.test(name)) return 'scan';
    if (/JOIN|UNION|INTERSECT|EXCEPT/.test(name)) return 'join';
    if (/AGGREGATE|WINDOW/.test(name)) return 'aggregate';
    if (/SORT|LIMIT/.test(name)) return 'sort';
    if (/EXCHANGE|REMOTE/.test(name)) return 'exchange';
    return 'other';
}

const CATEGORY_LABELS: Record<OperatorCategory, string> = {
    scan: 'Scan',
    join: 'Join',
    aggregate: 'Aggregate',
    sort: 'Sort & limit',
    exchange: 'Exchange',
    other: 'Other',
};

/// The facts of an operator at the current point of the progress, null where the engine reported nothing yet
interface OperatorFacts {
    operator: ProfileSceneOperator;
    category: OperatorCategory;
    status: dashql.buffers.profile.ProfileExecutionStatus;
    cpuUs: number | null;
    wallUs: number | null;
    blockedUs: number | null;
    rowsIn: number | null;
    rowsOut: number | null;
    bytesIn: number | null;
    memory: number | null;
    spilled: number | null;
}

interface StageFacts {
    id: number;
    /// The stage number of the engine, e.g. Trino's stage 1
    name: string;
    status: dashql.buffers.profile.ProfileExecutionStatus;
    operatorIds: readonly number[];
    cpuUs: number | null;
    rowsIn: number | null;
    memory: number | null;
    work: { done: number; total: number } | null;
}

/// A segment of the timeline: the CPU time of an operator, or of a stage whose operators are not reported yet
interface TimelineSegment {
    key: string;
    label: string;
    cpuUs: number;
    category: OperatorCategory | 'stage';
    running: boolean;
    select: Selection;
}

type Selection = { kind: 'operator'; id: number } | { kind: 'stage'; id: number } | null;

function displayName(operator: ProfileSceneOperator): string {
    return operator.typeName ?? operator.label;
}

/// The relation or detail next to the type of an operator, e.g. the table of a scan
function detailOf(operator: ProfileSceneOperator): string | null {
    return operator.label !== '' && operator.label !== operator.typeName ? operator.label : null;
}

/// The fragments of a Trino plan are its stages, numbered from the root
function stageName(fragmentId: number): string {
    return `Stage ${fragmentId}`;
}

function percent(share: number): string {
    if (share <= 0) return '0%';
    if (share < 0.01) return '<1%';
    return `${Math.round(share * 100)}%`;
}

/// The CPU time in the color of its share: hot at a quarter, warm at a tenth
function heatOf(share: number | null): 'hot' | 'warm' | 'cool' {
    if (share == null) return 'cool';
    return share >= 0.25 ? 'hot' : share >= 0.1 ? 'warm' : 'cool';
}

function statusLabel(status: dashql.buffers.profile.ProfileExecutionStatus): string {
    switch (status) {
        case STATUS.PENDING: return 'pending';
        case STATUS.RUNNING: return 'running';
        case STATUS.SUCCEEDED: return 'done';
        case STATUS.FAILED: return 'failed';
        case STATUS.SKIPPED: return 'skipped';
        default: return 'waiting';
    }
}

/// The status icons of the plan view: a dot while pending, the progress or a spinner while running, a check, a cross
function StatusIcon(props: { status: dashql.buffers.profile.ProfileExecutionStatus; progress: number | null }) {
    switch (props.status) {
        case STATUS.RUNNING:
            return (
                <>
                    <circle className={profileStyles.status_track} cx={8} cy={8} r={6.5} />
                    <circle cx={8} cy={8} r={3.5} />
                    {props.progress == null
                        ? <circle className={profileStyles.status_spinner} cx={8} cy={8} r={6.5} strokeDasharray="12 88" pathLength={100} />
                        : <circle className={profileStyles.status_progress} cx={8} cy={8} r={6.5} pathLength={100} strokeDasharray={`${props.progress} 100`} transform="rotate(-90 8 8)" />}
                </>
            );
        case STATUS.SUCCEEDED:
            return <path fillRule="evenodd" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z" />;
        case STATUS.FAILED:
            return <path fillRule="evenodd" d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z" />;
        default:
            return <circle cx={8} cy={8} r={3.5} />;
    }
}

export interface PlanFlowViewProps {
    /// The profile of the query, laid out in the orientation of the view
    plan: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    execution: ProfileExecutionState;
    /// The milliseconds since the query started
    elapsedMs: number;
    /// The engine and the name of the query in the header
    engine: string;
    title: string;
    /// Let the data flow in reading direction: the inputs first, the result last
    resultLast: boolean;
}

export function PlanFlowView(props: PlanFlowViewProps) {
    const { execution } = props;
    const scene = React.useMemo(() => materializeProfileScene(props.plan), [props.plan]);
    const [selection, setSelection] = React.useState<Selection>(null);
    const [hovered, setHovered] = React.useState<Selection>(null);

    const operators: OperatorFacts[] = React.useMemo(() => scene.operators.map(operator => {
        const state = execution.operators[operator.id];
        const fragment = operator.fragment === NO_INDEX ? undefined : execution.fragments[operator.fragment];
        return {
            operator,
            category: categoryOf(operator.kind),
            // An operator without a state of its own runs with its stage
            status: state?.status ?? fragment?.status ?? STATUS.UNKNOWN,
            cpuUs: stat(state, FIELD.CPU_TIME, s => s.cpuTimeUs),
            wallUs: stat(state, FIELD.WALL_TIME, s => s.wallTimeUs),
            blockedUs: stat(state, FIELD.BLOCKED_TIME, s => s.blockedTimeUs),
            rowsIn: stat(state, FIELD.TUPLES_IN, s => s.tuplesIn),
            rowsOut: stat(state, FIELD.TUPLES_OUT, s => s.tuplesOut),
            bytesIn: stat(state, FIELD.BYTES_IN, s => s.bytesIn),
            memory: stat(state, FIELD.MEMORY_BYTES, s => s.memoryBytes),
            spilled: stat(state, FIELD.SPILLED_BYTES, s => s.spilledBytes),
        };
    }), [scene, execution]);

    const stages: StageFacts[] = React.useMemo(() => scene.fragments.map(fragment => {
        const state = execution.fragments[fragment.id];
        return {
            id: fragment.id,
            name: stageName(fragment.id),
            status: state?.status ?? STATUS.UNKNOWN,
            operatorIds: fragment.operatorIds,
            cpuUs: stat(state, FIELD.CPU_TIME, s => s.cpuTimeUs),
            rowsIn: stat(state, FIELD.TUPLES_IN, s => s.tuplesIn),
            memory: stat(state, FIELD.MEMORY_BYTES, s => s.memoryBytes),
            work: workOf(state),
        };
    }), [scene, execution]);

    // The timeline: the stages in the order of their first operator (the inputs first), an operator per segment once
    // its stage reported its operators, else the CPU time of the stage as a whole
    const timeline: TimelineSegment[] = React.useMemo(() => {
        const ordered = [...stages].sort((a, b) => Math.min(...a.operatorIds) - Math.min(...b.operatorIds));
        const segments: TimelineSegment[] = [];
        for (const stage of ordered) {
            const reported = stage.operatorIds.map(id => operators[id]).filter(facts => facts?.cpuUs != null);
            if (reported.length > 0 && reported.length === stage.operatorIds.length) {
                for (const facts of [...reported].sort((a, b) => a.operator.id - b.operator.id)) {
                    segments.push({
                        key: `operator-${facts.operator.id}`,
                        label: displayName(facts.operator),
                        cpuUs: facts.cpuUs ?? 0,
                        category: facts.category,
                        running: false,
                        select: { kind: 'operator', id: facts.operator.id },
                    });
                }
            } else if ((stage.cpuUs ?? 0) > 0) {
                segments.push({
                    key: `stage-${stage.id}`,
                    label: stage.name,
                    cpuUs: stage.cpuUs ?? 0,
                    category: 'stage',
                    running: stage.status === STATUS.RUNNING,
                    select: { kind: 'stage', id: stage.id },
                });
            }
        }
        return segments;
    }, [stages, operators]);
    const totalCpuUs = timeline.reduce((sum, segment) => sum + segment.cpuUs, 0);
    const queryCpuUs = stat(execution.query, FIELD.CPU_TIME, s => s.cpuTimeUs) ?? totalCpuUs;
    const cpuShare = (cpuUs: number | null) => cpuUs == null || queryCpuUs === 0 ? null : cpuUs / queryCpuUs;

    // The rows over the edges, the edges are as thick as their rows
    const edgeRows = React.useMemo(() => scene.edges.map(edge => {
        const rows = execution.edgeRows(edge.slot, edge.childOperator);
        return rows == null ? null : Number(rows);
    }), [scene, execution]);
    const maxRows = edgeRows.reduce<number>((max, rows) => Math.max(max, rows ?? 0), 0);
    const edgeWidth = (rows: number | null) => rows == null || maxRows === 0
        ? EDGE_MIN_WIDTH
        : EDGE_MIN_WIDTH + (EDGE_MAX_WIDTH - EDGE_MIN_WIDTH) * Math.log1p(rows) / Math.log1p(maxRows);

    // The highlights above the plan
    const hottest = React.useMemo(() => {
        const operator = operators.reduce<OperatorFacts | null>((best, facts) => (facts.cpuUs ?? 0) > (best?.cpuUs ?? 0) ? facts : best, null);
        if (operator != null) return { kind: 'operator' as const, facts: operator };
        const stage = stages.reduce<StageFacts | null>((best, facts) => (facts.cpuUs ?? 0) > (best?.cpuUs ?? 0) ? facts : best, null);
        return stage == null ? null : { kind: 'stage' as const, facts: stage };
    }, [operators, stages]);
    const reducer = React.useMemo(() => operators.reduce<OperatorFacts | null>((best, facts) => {
        const dropped = (facts.rowsIn ?? 0) - (facts.rowsOut ?? 0);
        const bestDropped = best == null ? 0 : (best.rowsIn ?? 0) - (best.rowsOut ?? 0);
        return dropped > bestDropped ? facts : best;
    }, null), [operators]);
    // The running stages, the one with the most work first
    const running = stages
        .filter(stage => stage.status === STATUS.RUNNING)
        .sort((a, b) => (b.work?.total ?? 0) - (a.work?.total ?? 0));
    const hungriest = React.useMemo(() => operators.reduce<OperatorFacts | null>((best, facts) => (facts.memory ?? 0) > (best?.memory ?? 0) ? facts : best, null), [operators]);

    const queryStatus = execution.query?.status ?? STATUS.UNKNOWN;
    const queryWork = workOf(execution.query);
    const queryRows = stat(execution.query, FIELD.TUPLES_IN, s => s.tuplesIn);
    const queryMemory = stat(execution.query, FIELD.MEMORY_BYTES, s => s.memoryBytes);

    // The selection of the sidebar, else the hovered one
    const focus = hovered ?? selection;
    const isFocused = (candidate: Selection) => focus != null && candidate != null && focus.kind === candidate.kind && focus.id === candidate.id;
    const toggle = (candidate: Selection) => setSelection(current =>
        current != null && candidate != null && current.kind === candidate.kind && current.id === candidate.id ? null : candidate);

    return (
        <div className={styles.view} data-testid="plan-flow-view">
            <header className={styles.header}>
                <span className={styles.engine}>{props.engine}</span>
                <span className={styles.query_title}>{props.title}</span>
                <span className={styles.status_chip} data-status={queryStatus}>{statusLabel(queryStatus)}</span>
                <span className={styles.header_figure}>
                    <strong>{formatElapsed(props.elapsedMs)}</strong> elapsed
                </span>
                {queryWork != null && (
                    <span className={styles.header_figure}>
                        <strong>{queryWork.done}</strong>/{queryWork.total} splits
                    </span>
                )}
                {queryRows != null && <span className={styles.header_figure}><strong>{formatCompactCount(queryRows)}</strong> rows</span>}
                {queryCpuUs > 0 && <span className={styles.header_figure}><strong>{formatElapsed(queryCpuUs / 1000)}</strong> CPU</span>}
                {queryMemory != null && queryMemory > 0 && <span className={styles.header_figure}><strong>{formatCompactBytes(queryMemory)}</strong> peak</span>}
            </header>
            <div className={styles.highlights}>
                <Highlight
                    marker="hot"
                    title="Most CPU"
                    empty="No CPU time yet"
                    onSelect={hottest == null ? null : () => toggle(hottest.kind === 'operator'
                        ? { kind: 'operator', id: hottest.facts.operator.id }
                        : { kind: 'stage', id: hottest.facts.id })}
                    name={hottest == null ? null : hottest.kind === 'operator' ? displayName(hottest.facts.operator) : hottest.facts.name}
                    detail={hottest?.kind === 'operator' ? detailOf(hottest.facts.operator) : hottest != null ? 'operators not reported yet' : null}
                    figures={hottest == null ? null : `${formatElapsed((hottest.facts.cpuUs ?? 0) / 1000)} · ${percent(cpuShare(hottest.facts.cpuUs) ?? 0)}`}
                />
                <Highlight
                    marker="reduce"
                    title="Biggest reduction"
                    empty="Rows arrive when a stage finishes"
                    onSelect={reducer == null ? null : () => toggle({ kind: 'operator', id: reducer.operator.id })}
                    name={reducer == null ? null : displayName(reducer.operator)}
                    detail={reducer == null ? null : detailOf(reducer.operator)}
                    figures={reducer == null ? null : `−${formatCompactCount((reducer.rowsIn ?? 0) - (reducer.rowsOut ?? 0))} rows · ${percent((reducer.rowsOut ?? 0) / Math.max(1, reducer.rowsIn ?? 1))} kept`}
                />
                {running.length > 0 ? (
                    <Highlight
                        marker="running"
                        title="Running now"
                        empty=""
                        onSelect={() => toggle({ kind: 'stage', id: running[0].id })}
                        name={running[0].name}
                        detail={running.length > 1 ? `+${running.length - 1} more` : null}
                        figures={running[0].work == null ? 'scheduling' : `${running[0].work.done}/${running[0].work.total} splits`}
                    />
                ) : (
                    <Highlight
                        marker="memory"
                        title="Most memory"
                        empty="No memory reported yet"
                        onSelect={hungriest == null ? null : () => toggle({ kind: 'operator', id: hungriest.operator.id })}
                        name={hungriest == null ? null : displayName(hungriest.operator)}
                        detail={hungriest == null ? null : detailOf(hungriest.operator)}
                        figures={hungriest == null ? null : formatCompactBytes(hungriest.memory ?? 0)}
                    />
                )}
            </div>
            <div className={styles.card}>
                <Timeline
                    segments={timeline}
                    totalCpuUs={totalCpuUs}
                    isFocused={isFocused}
                    onSelect={toggle}
                    onHover={setHovered}
                />
                <div className={styles.body}>
                    <PlanCanvas
                        scene={scene}
                        operators={operators}
                        stages={stages}
                        edgeRows={edgeRows}
                        edgeWidth={edgeWidth}
                        cpuShare={cpuShare}
                        resultLast={props.resultLast}
                        focus={focus}
                        onSelect={toggle}
                        onHover={setHovered}
                        onClear={() => setSelection(null)}
                    />
                    <aside className={styles.sidebar} aria-label="Details">
                        {focus?.kind === 'operator' && operators[focus.id] != null ? (
                            <OperatorPanel
                                facts={operators[focus.id]}
                                stage={stages.find(stage => stage.id === operators[focus.id].operator.fragment) ?? null}
                                share={cpuShare(operators[focus.id].cpuUs)}
                                maxMemory={hungriest?.memory ?? 0}
                                estimate={scene.edges.find(edge => edge.childOperator === focus.id)?.outputCardinalityEstimated ?? null}
                            />
                        ) : focus?.kind === 'stage' && stages.find(stage => stage.id === focus.id) != null ? (
                            <StagePanel
                                stage={stages.find(stage => stage.id === focus.id)!}
                                operators={operators}
                                share={cpuShare(stages.find(stage => stage.id === focus.id)!.cpuUs)}
                                onSelect={toggle}
                                onHover={setHovered}
                            />
                        ) : (
                            <QueryPanel
                                status={queryStatus}
                                work={queryWork}
                                stages={stages}
                                cpuShare={cpuShare}
                                onSelect={toggle}
                                onHover={setHovered}
                            />
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}

function Highlight(props: {
    marker: 'hot' | 'reduce' | 'running' | 'memory';
    title: string;
    empty: string;
    name: string | null;
    detail: string | null;
    figures: string | null;
    onSelect: (() => void) | null;
}) {
    return (
        <button type="button" className={styles.highlight} disabled={props.onSelect == null} onClick={props.onSelect ?? undefined}>
            <span className={styles.highlight_title}>
                <i className={styles.highlight_marker} data-marker={props.marker} aria-hidden="true" />
                {props.title}
            </span>
            {props.name == null
                ? <span className={styles.highlight_empty}>{props.empty}</span>
                : (
                    <span className={styles.highlight_value}>
                        <span className={styles.highlight_name}>
                            {props.name}
                            {props.detail != null && <span className={styles.highlight_detail}> · {props.detail}</span>}
                        </span>
                        {props.figures != null && <span className={styles.highlight_figures}>{props.figures}</span>}
                    </span>
                )}
        </button>
    );
}

function Timeline(props: {
    segments: TimelineSegment[];
    totalCpuUs: number;
    isFocused: (selection: Selection) => boolean;
    onSelect: (selection: Selection) => void;
    onHover: (selection: Selection) => void;
}) {
    return (
        <div className={styles.timeline} role="list" aria-label="CPU time by operator">
            <span className={styles.timeline_total}>{props.totalCpuUs > 0 ? `${formatElapsed(props.totalCpuUs / 1000)} CPU` : 'CPU'}</span>
            <div className={styles.timeline_track}>
                {props.segments.length === 0 && <span className={styles.timeline_empty}>Waiting for the first CPU time…</span>}
                {props.segments.map(segment => (
                    <button
                        type="button"
                        role="listitem"
                        key={segment.key}
                        className={styles.segment}
                        data-category={segment.category}
                        data-running={segment.running || undefined}
                        data-focused={props.isFocused(segment.select) || undefined}
                        style={{ flexGrow: segment.cpuUs }}
                        title={`${segment.label} · ${formatElapsed(segment.cpuUs / 1000)} · ${percent(segment.cpuUs / Math.max(1, props.totalCpuUs))}`}
                        onClick={() => props.onSelect(segment.select)}
                        onMouseEnter={() => props.onHover(segment.select)}
                        onMouseLeave={() => props.onHover(null)}
                    >
                        <span className={styles.segment_label}>
                            {segment.label} <span className={styles.segment_share}>{percent(segment.cpuUs / Math.max(1, props.totalCpuUs))}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

interface PlanCanvasProps {
    scene: ProfileScene;
    operators: OperatorFacts[];
    stages: StageFacts[];
    edgeRows: (number | null)[];
    edgeWidth: (rows: number | null) => number;
    cpuShare: (cpuUs: number | null) => number | null;
    resultLast: boolean;
    focus: Selection;
    onSelect: (selection: Selection) => void;
    onHover: (selection: Selection) => void;
    onClear: () => void;
}

function PlanCanvas(props: PlanCanvasProps) {
    const { scene, focus } = props;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const sceneRef = React.useRef<SVGGElement | null>(null);
    const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

    // Mirror the plan so that the data flows in reading direction: the root goes right or down
    const mirrorX = scene.leftToRight && props.resultLast;
    const mirrorY = !scene.leftToRight && props.resultLast;
    const tx = (x: number) => mirrorX ? scene.width - x : x;
    const ty = (y: number) => mirrorY ? scene.height - y : y;
    const mirror = mirrorX ? `translate(${scene.width}, 0) scale(-1, 1)` : mirrorY ? `translate(0, ${scene.height}) scale(1, -1)` : undefined;

    // Fit the plan, but not below a scale that keeps the labels readable. A plan that doesn't fit then starts where the
    // data starts, the inputs, and the rest is a pan away.
    const fit = React.useCallback((whole = false, animate = false) => {
        const viewport = viewportRef.current;
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        const group = sceneRef.current;
        if (viewport == null || svg == null || behavior == null || group == null) return;
        let box: DOMRect | null;
        try { box = group.getBBox(); } catch { box = null; }
        if (box == null || box.width <= 0 || box.height <= 0) return;
        const bounds = { left: box.x, top: box.y, width: box.width, height: box.height };
        let { x, y, scale } = computeProfileFitTransform(bounds, viewport.clientWidth, viewport.clientHeight);
        if (!whole && scale < MIN_READABLE_SCALE) {
            scale = MIN_READABLE_SCALE;
            const centered = (size: number, extent: number, start: number) => (size - extent * scale) / 2 - start * scale;
            // The inputs are on the far side of the root: right of a left-to-right plan, below a top-down one,
            // mirrored they swap
            const inputsFirst = scene.leftToRight ? !mirrorX : !mirrorY;
            if (scene.leftToRight) {
                x = inputsFirst ? viewport.clientWidth - FIT_PADDING - (bounds.left + bounds.width) * scale : FIT_PADDING - bounds.left * scale;
                y = Math.max(FIT_PADDING - bounds.top * scale, centered(viewport.clientHeight, bounds.height, bounds.top));
            } else {
                y = inputsFirst ? viewport.clientHeight - FIT_PADDING - (bounds.top + bounds.height) * scale : FIT_PADDING - bounds.top * scale;
                x = Math.max(FIT_PADDING - bounds.left * scale, centered(viewport.clientWidth, bounds.width, bounds.left));
            }
        }
        behavior.scaleExtent([Math.min(0.1, scale), 4]);
        const target = zoomIdentity.translate(x, y).scale(scale);
        (animate ? select(svg).transition().duration(200) : select(svg)).call(behavior.transform as never, target);
    }, [scene.leftToRight, mirrorX, mirrorY]);

    const zoomBy = (factor: number) => {
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (svg != null && behavior != null) select(svg).transition().duration(120).call(behavior.scaleBy as never, factor);
    };

    React.useLayoutEffect(() => {
        const svg = svgRef.current;
        const viewport = viewportRef.current;
        if (svg == null || viewport == null) return;
        const behavior = zoom<SVGSVGElement, unknown>()
            .extent((): [[number, number], [number, number]] => [[0, 0], [viewport.clientWidth, viewport.clientHeight]])
            .scaleExtent([0.1, 4])
            .clickDistance(4)
            .on('zoom', event => sceneRef.current?.setAttribute('transform', event.transform.toString()));
        zoomRef.current = behavior;
        select(svg).call(behavior).on('dblclick.zoom', null);
        const observer = new ResizeObserver(() => fit());
        observer.observe(viewport);
        return () => {
            observer.disconnect();
            select(svg).on('.zoom', null);
            zoomRef.current = null;
        };
    }, [fit]);

    // Fit again when the plan changes its shape, not with every update of the progress
    const shape = `${scene.leftToRight}-${scene.operators.length}-${scene.width}-${scene.height}-${props.resultLast}`;
    React.useLayoutEffect(() => fit(), [fit, shape]);

    const focusedOperator = focus?.kind === 'operator' ? focus.id : null;
    const focusedStage = focus?.kind === 'stage' ? focus.id : null;
    const input = scene.layoutConfig.input!;

    return (
        <div ref={viewportRef} className={styles.canvas}>
            <svg ref={svgRef} className={styles.svg} onClick={event => { if (event.target === svgRef.current) props.onClear(); }}>
                <g ref={sceneRef}>
                    <g transform={mirror}>
                        {scene.fragments.map(fragment => {
                            const stage = props.stages.find(candidate => candidate.id === fragment.id);
                            return (
                                <path
                                    key={fragment.id}
                                    className={styles.contour}
                                    d={fragment.path}
                                    data-status={stage?.status}
                                    data-focused={focusedStage === fragment.id || undefined}
                                />
                            );
                        })}
                        {scene.edges.map((edge, index) => {
                            const rows = props.edgeRows[index];
                            const child = props.operators[edge.childOperator];
                            const highlighted = focusedOperator != null && (edge.childOperator === focusedOperator || edge.parentOperator === focusedOperator)
                                || focusedStage != null && child?.operator.fragment === focusedStage;
                            return (
                                <path
                                    key={edge.id}
                                    className={styles.flow}
                                    d={edge.path}
                                    style={{ strokeWidth: props.edgeWidth(rows) }}
                                    data-known={rows != null || undefined}
                                    data-streaming={rows == null && child?.status === STATUS.RUNNING || undefined}
                                    data-highlighted={highlighted || undefined}
                                />
                            );
                        })}
                    </g>
                    {scene.operators.map(operator => (
                        <FlowOperator
                            key={operator.id}
                            facts={props.operators[operator.id]}
                            stage={props.stages.find(stage => stage.id === operator.fragment) ?? null}
                            input={input}
                            leftToRight={scene.leftToRight}
                            mirrored={props.resultLast}
                            cx={tx(operator.rect.x)}
                            cy={ty(operator.rect.y)}
                            share={props.cpuShare(props.operators[operator.id].cpuUs)}
                            focused={focusedOperator === operator.id}
                            onSelect={() => props.onSelect({ kind: 'operator', id: operator.id })}
                            onHover={hovering => props.onHover(hovering ? { kind: 'operator', id: operator.id } : null)}
                        />
                    ))}
                    {/* The rows of an edge next to the output of its child, where the flow leaves it */}
                    <g className={styles.row_labels} aria-hidden="true">
                        {scene.edges.map((edge, index) => {
                            const rows = props.edgeRows[index];
                            const child = scene.operators[edge.childOperator];
                            if (rows == null || child == null) return null;
                            const width = props.edgeWidth(rows);
                            const cx = tx(child.rect.x);
                            const cy = ty(child.rect.y);
                            const halfWidth = child.rect.width / 2;
                            const halfHeight = child.rect.height / 2;
                            if (scene.leftToRight) {
                                const right = props.resultLast;
                                return (
                                    <text key={edge.id} x={right ? cx + halfWidth + 8 : cx - halfWidth - 8} y={cy - width / 2 - 5} textAnchor={right ? 'start' : 'end'}>
                                        {formatCompactCount(rows)}
                                    </text>
                                );
                            }
                            const below = props.resultLast;
                            return (
                                <text key={edge.id} x={cx + width / 2 + 6} y={below ? cy + halfHeight + 16 : cy - halfHeight - 8} textAnchor="start">
                                    {formatCompactCount(rows)}
                                </text>
                            );
                        })}
                    </g>
                </g>
            </svg>
            <div className={styles.zoom_controls}>
                <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
                <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>−</button>
                <button type="button" aria-label="Show the whole plan" onClick={() => fit(true, true)}>Fit</button>
            </div>
            <div className={styles.legend} aria-hidden="true">
                <span className={styles.legend_flow}><i data-width="thin" /><i data-width="thick" /> rows</span>
                <span className={styles.legend_flow}><i data-streaming="true" /> streaming</span>
                <span className={styles.legend_heat}><i data-heat="hot" /> ≥25% CPU</span>
            </div>
        </div>
    );
}

function FlowOperator(props: {
    facts: OperatorFacts;
    stage: StageFacts | null;
    input: dashql.buffers.profile.ProfileLayoutConfigT;
    leftToRight: boolean;
    mirrored: boolean;
    cx: number;
    cy: number;
    share: number | null;
    focused: boolean;
    onSelect: () => void;
    onHover: (hovering: boolean) => void;
}) {
    const { operator } = props.facts;
    const { input } = props;
    const width = operator.rect.width;
    const height = operator.rect.height;
    const x = props.cx - width / 2;
    const y = props.cy - height / 2;
    const regionStart = input.nodePaddingLeft + STATUS_ICON_SIZE + input.iconMarginRight;
    const regionEnd = width - input.nodePaddingRight;
    const symbolName = shouldRenderProfileOperatorSymbol(operator.kind, operator.typeName, operator.label) ? getProfileOperatorSymbol(operator.kind) : null;
    const OperatorSymbol = symbolName != null ? SymbolIcon(symbolName) : null;
    const progress = props.stage?.work != null && props.stage.status === STATUS.RUNNING && props.stage.work.done > 0
        ? Math.round(props.stage.work.done / props.stage.work.total * 100)
        : null;
    // The output faces the parent, the input the children. Mirrored, the sides swap.
    const outputSide = props.leftToRight ? (props.mirrored ? 'right' : 'left') : (props.mirrored ? 'bottom' : 'top');
    const inputSide = props.leftToRight ? (props.mirrored ? 'left' : 'right') : (props.mirrored ? 'top' : 'bottom');
    const portAt = (side: 'left' | 'right' | 'top' | 'bottom') => side === 'left' ? { x: 0, y: height / 2 }
        : side === 'right' ? { x: width, y: height / 2 }
            : side === 'top' ? { x: width / 2, y: 0 }
                : { x: width / 2, y: height };
    const cpu = props.facts.cpuUs;
    return (
        <g
            className={`${profileStyles.operator} ${styles.operator}`}
            transform={`translate(${x}, ${y})`}
            data-selected={props.focused}
            data-status={props.facts.status}
            role="button"
            tabIndex={0}
            aria-label={`${displayName(operator)}${detailOf(operator) != null ? ` ${detailOf(operator)}` : ''}, ${statusLabel(props.facts.status)}`}
            onClick={event => { event.stopPropagation(); props.onSelect(); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelect(); } }}
            onMouseEnter={() => props.onHover(true)}
            onMouseLeave={() => props.onHover(false)}
        >
            <rect className={graphStyles.node_frame} width={width} height={height} rx={6} ry={6} />
            <g
                className={profileStyles.status}
                data-status={props.facts.status}
                transform={`translate(${input.nodePaddingLeft}, ${(height - STATUS_ICON_SIZE) / 2})`}
                aria-hidden="true"
            >
                <g transform={`scale(${STATUS_ICON_SIZE / 16})`}>
                    <StatusIcon status={props.facts.status} progress={progress} />
                </g>
            </g>
            {OperatorSymbol != null
                ? <g className={profileStyles.operator_symbol} transform={`translate(${(regionStart + regionEnd - PROFILE_OPERATOR_SYMBOL_SIZE) / 2}, ${(height - PROFILE_OPERATOR_SYMBOL_SIZE) / 2})`} aria-hidden="true"><OperatorSymbol size={PROFILE_OPERATOR_SYMBOL_SIZE} /></g>
                : <text x={(regionStart + regionEnd) / 2} y={height / 2 + 5}>{operator.displayLabel}</text>}
            {(operator.ports & PROFILE_OPERATOR_PORT_OUTPUT) !== 0 && <GraphPort {...portAt(outputSide)} side={outputSide} highlighted={props.focused} />}
            {(operator.ports & PROFILE_OPERATOR_PORT_INPUT) !== 0 && <GraphPort {...portAt(inputSide)} side={inputSide} highlighted={props.focused} />}
            {cpu != null && cpu > 0 && (
                // The CPU time below the operator, or right of it in a top-down plan
                <text
                    className={styles.caption}
                    data-heat={heatOf(props.share)}
                    x={props.leftToRight ? width / 2 : width + 8}
                    y={props.leftToRight ? height + 15 : height / 2 + 4}
                    textAnchor={props.leftToRight ? 'middle' : 'start'}
                >
                    {formatElapsed(cpu / 1000)}
                </text>
            )}
        </g>
    );
}

/// A labeled bar of the sidebar with its value on the right
function MeterRow(props: { label: string; value: string; fraction: number; tone?: 'flow' | 'hot' | 'muted' | 'attention' }) {
    return (
        <div className={styles.meter_row}>
            <span className={styles.meter_label}>{props.label}</span>
            <span className={styles.meter_track}>
                <i data-tone={props.tone ?? 'flow'} style={{ width: `${Math.max(props.fraction > 0 ? 1.5 : 0, Math.min(1, props.fraction) * 100)}%` }} />
            </span>
            <span className={styles.meter_value}>{props.value}</span>
        </div>
    );
}

function Section(props: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className={styles.section}>
            <h3 className={styles.section_title}>
                <span>{props.title}</span>
                {props.note != null && <span className={styles.section_note}>{props.note}</span>}
            </h3>
            {props.children}
        </section>
    );
}

const ROW_FORMAT = new Intl.NumberFormat('en-US');

function OperatorPanel(props: { facts: OperatorFacts; stage: StageFacts | null; share: number | null; maxMemory: number; estimate: number | null }) {
    const { facts } = props;
    const { operator } = facts;
    const rowsMax = Math.max(facts.rowsIn ?? 0, facts.rowsOut ?? 0);
    const kept = facts.rowsIn != null && facts.rowsOut != null && facts.rowsIn > 0 ? facts.rowsOut / facts.rowsIn : null;
    const timeTotal = (facts.cpuUs ?? 0) + (facts.blockedUs ?? 0);
    const details = formatDetails(operator.properties);
    return (
        <div className={styles.panel} data-testid="plan-flow-operator">
            <div className={styles.panel_header}>
                <div className={styles.panel_name}>
                    <i className={styles.swatch} data-category={facts.category} aria-hidden="true" />
                    <span>{displayName(operator)}</span>
                </div>
                {facts.cpuUs != null && <span className={styles.panel_big} data-heat={heatOf(props.share)}>{formatElapsed(facts.cpuUs / 1000)}</span>}
                <span className={styles.panel_sub}>{detailOf(operator) ?? CATEGORY_LABELS[facts.category]}</span>
                {props.share != null && <span className={styles.panel_sub_right} data-heat={heatOf(props.share)}>{percent(props.share)} of CPU</span>}
            </div>
            {props.stage != null && (
                <Section title={props.stage.name} note={statusLabel(props.stage.status)}>
                    {props.stage.work != null && (
                        <MeterRow label="splits" value={`${props.stage.work.done}/${props.stage.work.total}`} fraction={props.stage.work.done / props.stage.work.total} tone="attention" />
                    )}
                </Section>
            )}
            {facts.rowsIn == null && facts.rowsOut == null ? (
                <Section title="Rows">
                    <p className={styles.waiting}>The rows of the operator arrive when its stage finishes.</p>
                </Section>
            ) : (
                <Section
                    title="Rows"
                    note={kept == null ? null : kept <= 1
                        ? <span data-tone={kept < 0.1 ? 'attention' : undefined}>{percent(kept)} kept</span>
                        : <span>{Number(kept.toPrecision(2))}× more</span>}
                >
                    {facts.rowsIn != null && <MeterRow label="in" value={ROW_FORMAT.format(facts.rowsIn)} fraction={rowsMax === 0 ? 0 : facts.rowsIn / rowsMax} tone="muted" />}
                    {facts.rowsOut != null && <MeterRow label="out" value={ROW_FORMAT.format(facts.rowsOut)} fraction={rowsMax === 0 ? 0 : facts.rowsOut / rowsMax} />}
                    {facts.bytesIn != null && facts.bytesIn > 0 && <p className={styles.panel_line}>{formatCompactBytes(facts.bytesIn)} read</p>}
                </Section>
            )}
            {props.estimate != null && facts.rowsOut != null && (
                <EstimateSection estimate={props.estimate} actual={facts.rowsOut} />
            )}
            {facts.cpuUs != null && (
                <Section title="Time" note={facts.wallUs == null ? null : `${formatElapsed(facts.wallUs / 1000)} wall`}>
                    <div className={styles.stack} aria-label="CPU and blocked time">
                        <i data-tone="hot" style={{ flexGrow: facts.cpuUs }} />
                        <i data-tone="muted" style={{ flexGrow: facts.blockedUs ?? 0 }} />
                    </div>
                    <div className={styles.stack_legend}>
                        <span><i data-tone="hot" />cpu {formatElapsed(facts.cpuUs / 1000)}</span>
                        {facts.blockedUs != null && facts.blockedUs > 0 && <span><i data-tone="muted" />blocked {formatElapsed(facts.blockedUs / 1000)}</span>}
                        {timeTotal > 0 && facts.blockedUs != null && <span className={styles.stack_share}>{percent(facts.cpuUs / timeTotal)} busy</span>}
                    </div>
                </Section>
            )}
            {facts.memory != null && (
                <Section title="Memory" note={facts.spilled != null && facts.spilled > 0 ? <span data-tone="attention">spilled {formatCompactBytes(facts.spilled)}</span> : null}>
                    <MeterRow label="peak" value={formatCompactBytes(facts.memory)} fraction={props.maxMemory === 0 ? 0 : facts.memory / props.maxMemory} tone="muted" />
                </Section>
            )}
            {details.length > 0 && (
                <dl className={styles.details}>
                    {details.map(([key, value]) => (
                        <React.Fragment key={key}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
        </div>
    );
}

/// The properties of an operator as lines: strings as they are, lists one item per line, objects one level deep.
/// The output columns are left out, they repeat what the plan says elsewhere.
function formatDetails(properties: Record<string, unknown>): [string, string][] {
    const text = (value: unknown): string => typeof value === 'string' ? value
        : Array.isArray(value) ? value.map(text).join('\n')
            : JSON.stringify(value);
    const lines: [string, string][] = [];
    for (const [key, value] of Object.entries(properties)) {
        if (value == null || value === '' || /^(id|name|label|outputs)$/i.test(key)) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        if (typeof value === 'object' && !Array.isArray(value)) {
            for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
                if (innerValue != null && innerValue !== '') lines.push([inner, text(innerValue)]);
            }
        } else {
            lines.push([key, text(value)]);
        }
    }
    return lines.slice(0, 8);
}

/// The estimate of the planner against the actual rows on a log scale, like the rows per loop of an EXPLAIN ANALYZE
function EstimateSection(props: { estimate: number; actual: number }) {
    const max = Math.max(10, props.estimate, props.actual) * 10;
    const position = (value: number) => `${Math.log10(1 + value) / Math.log10(1 + max) * 100}%`;
    const ratio = props.estimate === 0 ? Infinity : props.actual / props.estimate;
    const note = ratio >= 1 ? `${Number(ratio.toPrecision(2))}× more` : `${Number((1 / ratio).toPrecision(2))}× fewer`;
    return (
        <Section title="Estimate" note={<span data-tone={ratio > 10 || ratio < 0.1 ? 'attention' : undefined}>{note}</span>}>
            <div className={styles.estimate}>
                <span className={styles.estimate_axis} />
                <span className={styles.estimate_span} style={{ left: position(Math.min(props.estimate, props.actual)), right: `calc(100% - ${position(Math.max(props.estimate, props.actual))})` }} />
                <span className={styles.estimate_mark} data-kind="estimate" style={{ left: position(props.estimate) }}><span>{formatCompactCount(props.estimate)}</span></span>
                <span className={styles.estimate_mark} data-kind="actual" style={{ left: position(props.actual) }}><span>{formatCompactCount(props.actual)}</span></span>
            </div>
        </Section>
    );
}

function StagePanel(props: { stage: StageFacts; operators: OperatorFacts[]; share: number | null; onSelect: (selection: Selection) => void; onHover: (selection: Selection) => void }) {
    const { stage } = props;
    const members = stage.operatorIds.map(id => props.operators[id]).filter((facts): facts is OperatorFacts => facts != null);
    const maxCpu = members.reduce((max, facts) => Math.max(max, facts.cpuUs ?? 0), 0);
    return (
        <div className={styles.panel} data-testid="plan-flow-stage">
            <div className={styles.panel_header}>
                <div className={styles.panel_name}>
                    <i className={styles.swatch} data-category="stage" aria-hidden="true" />
                    <span>{stage.name}</span>
                </div>
                {stage.cpuUs != null && <span className={styles.panel_big} data-heat={heatOf(props.share)}>{formatElapsed(stage.cpuUs / 1000)}</span>}
                <span className={styles.panel_sub}>{statusLabel(stage.status)} · {members.length} operators</span>
                {props.share != null && <span className={styles.panel_sub_right} data-heat={heatOf(props.share)}>{percent(props.share)} of CPU</span>}
            </div>
            <Section title="Progress" note={stage.work == null ? null : `${percent(stage.work.done / stage.work.total)}`}>
                {stage.work != null
                    ? <MeterRow label="splits" value={`${stage.work.done}/${stage.work.total}`} fraction={stage.work.done / stage.work.total} tone="attention" />
                    : <p className={styles.waiting}>No splits scheduled yet.</p>}
                {stage.rowsIn != null && stage.rowsIn > 0 && <p className={styles.panel_line}>{ROW_FORMAT.format(stage.rowsIn)} rows read</p>}
                {stage.memory != null && stage.memory > 0 && <p className={styles.panel_line}>{formatCompactBytes(stage.memory)} peak memory</p>}
            </Section>
            <Section title="Operators" note={maxCpu > 0 ? 'cpu' : 'not reported yet'}>
                <ul className={styles.operator_list}>
                    {members.map(facts => (
                        <li key={facts.operator.id}>
                            <button
                                type="button"
                                onClick={() => props.onSelect({ kind: 'operator', id: facts.operator.id })}
                                onMouseEnter={() => props.onHover({ kind: 'operator', id: facts.operator.id })}
                                onMouseLeave={() => props.onHover(null)}
                            >
                                <i className={styles.swatch} data-category={facts.category} aria-hidden="true" />
                                <span className={styles.operator_list_name}>{displayName(facts.operator)}{detailOf(facts.operator) != null && <span> {detailOf(facts.operator)}</span>}</span>
                                <span className={styles.operator_list_bar}><i style={{ width: `${maxCpu === 0 ? 0 : (facts.cpuUs ?? 0) / maxCpu * 100}%` }} /></span>
                                <span className={styles.operator_list_value}>{facts.cpuUs == null ? '–' : formatElapsed(facts.cpuUs / 1000)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </Section>
        </div>
    );
}

function QueryPanel(props: {
    status: dashql.buffers.profile.ProfileExecutionStatus;
    work: { done: number; total: number } | null;
    stages: StageFacts[];
    cpuShare: (cpuUs: number | null) => number | null;
    onSelect: (selection: Selection) => void;
    onHover: (selection: Selection) => void;
}) {
    return (
        <div className={styles.panel} data-testid="plan-flow-query">
            <div className={styles.panel_header}>
                <div className={styles.panel_name}><span>Query</span></div>
                {props.work != null && <span className={styles.panel_big}>{percent(props.work.done / props.work.total)}</span>}
                <span className={styles.panel_sub}>{statusLabel(props.status)}</span>
                {props.work != null && <span className={styles.panel_sub_right}>{props.work.done}/{props.work.total} splits</span>}
            </div>
            <Section title="Stages" note="splits · cpu">
                <ul className={styles.stage_list}>
                    {[...props.stages].reverse().map(stage => (
                        <li key={stage.id}>
                            <button
                                type="button"
                                data-status={stage.status}
                                onClick={() => props.onSelect({ kind: 'stage', id: stage.id })}
                                onMouseEnter={() => props.onHover({ kind: 'stage', id: stage.id })}
                                onMouseLeave={() => props.onHover(null)}
                            >
                                <span className={styles.stage_list_name}>{stage.name}</span>
                                <span className={styles.stage_list_status}>{statusLabel(stage.status)}</span>
                                <span className={styles.meter_track}>
                                    <i data-tone="attention" style={{ width: `${stage.work == null ? 0 : stage.work.done / stage.work.total * 100}%` }} />
                                </span>
                                <span className={styles.stage_list_value}>
                                    {stage.cpuUs == null || stage.cpuUs === 0 ? '–' : formatElapsed(stage.cpuUs / 1000)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </Section>
            <p className={styles.hint}>Select an operator, a stage or a segment of the timeline for its details.</p>
        </div>
    );
}

