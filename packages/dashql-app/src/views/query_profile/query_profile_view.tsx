import * as React from 'react';
import { ZoomInIcon, ZoomOutIcon } from '../../ui/foundations/symbol_icon.js';
import { color as parseColor, interpolateBrBG, interpolateOrRd, interpolatePuOr, interpolateRdBu, interpolateRdPu, select, zoom, zoomIdentity, ZoomBehavior, ZoomTransform } from 'd3';

import * as dashql from '@ankoh/dashql-core';
import { JsonView } from '../../ui/json/json_view.js';
import { IconButton, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { ButtonGroup } from '../../ui/foundations/button_group.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { OverlaySize } from '../../ui/foundations/overlay.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { computeProfileFitTransform, ProfileFitBounds } from './profile_fit.js';
import { createProfileLayoutConfig, PROFILE_OPERATOR_ANNOTATION_WIDTH } from './profile_layout_config.js';
import { ProfileExecutionController } from './profile_execution_controller.js';
import { isStatReported, ProfileExecutionState, type ProfileEntityState } from '../../query/profile_execution_state.js';
import { formatCompactBytes, formatCompactCount, formatElapsed, stat, workOf } from '../query_progress/query_progress_model.js';
import { findProfileOperatorInDirection } from './profile_navigation.js';
import type { ProfileNavigationDirection } from './profile_navigation.js';
import { getProfileOperatorSymbol, PROFILE_OPERATOR_SYMBOL_SIZE, shouldRenderProfileOperatorSymbol } from './profile_operator_symbol.js';
import { estimateRelativeDifference, materializeProfileScene, PROFILE_OPERATOR_PORT_INPUT, PROFILE_OPERATOR_PORT_OUTPUT, ProfileScene, ProfileSceneEdge, ProfileSceneOperator } from './profile_scene.js';
import * as styles from './query_profile_view.module.css';
import * as graphStyles from '../../ui/graph/graph.module.css';
import { GraphPort } from '../../ui/graph/graph_port.js';

/** The default zoom limits of the plan, a fit of a large plan lowers the minimum */
const PROFILE_MIN_ZOOM = 0.1;
const PROFILE_MAX_ZOOM = 4;
const FitIcon = SymbolIcon('focus_center_16');
const RotateIcon = SymbolIcon('rotate_16');
const PaintbrushIcon = SymbolIcon('paintbrush_16');

/**
 * Measure the drawn plan in scene coordinates. Operators drawn as symbols are narrower than their layout, and the
 * fragment contours and badges reach beyond it, so the layout bounds are only the fallback when nothing is drawn.
 * The bounding box of the scene group excludes its own zoom transform.
 */
function measurePlanBounds(group: SVGGElement | null, scene: Pick<ProfileScene, 'width' | 'height'>): ProfileFitBounds {
    try {
        const box = group?.getBBox();
        if (box != null && box.width > 0 && box.height > 0) {
            return { left: box.x, top: box.y, width: box.width, height: box.height };
        }
    } catch {
        // getBBox throws for a group that is not rendered
    }
    return { left: 0, top: 0, width: scene.width, height: scene.height };
}

const EDGE_WIDTH = 2;
/// The size of the status icon in the annotation slot of an operator
const STATUS_ICON_SIZE = 14;
/// The row annotation of an edge is a pill in the annotation slot of its child operator, whose output flows over it
const OPERATOR_ANNOTATION_MIN_WIDTH = 20;
const OPERATOR_ANNOTATION_HEIGHT = 16;
/// The width of a character of the annotation (9px monospace) and the padding of the pill
const OPERATOR_ANNOTATION_CHAR_WIDTH = 5.5;
const OPERATOR_ANNOTATION_PADDING = 8;
const ESTIMATE_APPROXIMATE_ROW_THRESHOLD = 100;
/// The colors of the badges and the highlighted edge, tokens of the theme.
/// SVG attributes do not resolve var(), the badges set them as style properties.
const EDGE_BADGE_BORDER = 'var(--color_border)';
const EDGE_HIGHLIGHT_COLOR = 'var(--color_accent_emphasis)';
const EDGE_HIGHLIGHT_TEXT_COLOR = 'var(--color_fg_on_emphasis)';
/// What the annotation slot of the operators shows: the status icon, nothing, the actual rows, the estimated rows of
/// the planner, the accuracy of the estimate, the CPU share or the memory of the operator. Every mode shows one kind of
/// value only, an operator without that value (no actual rows yet, no estimate, no statistics) shows nothing. The status
/// only exists with progress. Rows, estimates and accuracy annotate the edge to the parent, CPU and memory the operator.
type ProfileAnnotationMode = 'status' | 'plain' | 'rows' | 'estimates' | 'accuracy' | 'cpu' | 'memory';
const PROFILE_ANNOTATION_MODES: readonly { mode: ProfileAnnotationMode; label: string }[] = [
    { mode: 'status', label: 'Status' },
    { mode: 'plain', label: 'Plain' },
    { mode: 'rows', label: 'Rows' },
    { mode: 'estimates', label: 'Estimates' },
    { mode: 'accuracy', label: 'Accuracy' },
    { mode: 'cpu', label: 'CPU' },
    { mode: 'memory', label: 'Memory' },
];
/// The border of the memory annotation of an operator that spilled to disk
const SPILLED_BADGE_BORDER = 'var(--color_attention_fg)';
/// The status icons of an operator in a 16x16 box, the status of the operator picks one (see the controller).
/// The icons look like the status indicators of the app: a dot while pending, a spinner or the progress while
/// running, a check, a cross. The check, the cross and the slash are cut out of their circles, they need the
/// even-odd rule.
function StatusIcons(props: { progress: number | null }) {
    const status = dashql.buffers.profile.ProfileExecutionStatus;
    return (
        <>
            <g data-status-icon={status.UNKNOWN}><circle cx={8} cy={8} r={3.5} /></g>
            <g data-status-icon={status.PENDING}><circle cx={8} cy={8} r={3.5} /></g>
            <g data-status-icon={status.RUNNING}>
                <circle className={styles.status_track} cx={8} cy={8} r={6.5} />
                <circle cx={8} cy={8} r={3.5} />
                {props.progress == null
                    ? <circle className={styles.status_spinner} cx={8} cy={8} r={6.5} strokeDasharray="12 88" pathLength={100} />
                    : (
                        // The completed share of the work, clockwise from the top
                        <circle
                            className={styles.status_progress}
                            cx={8}
                            cy={8}
                            r={6.5}
                            pathLength={100}
                            strokeDasharray={`${props.progress} 100`}
                            transform="rotate(-90 8 8)"
                            data-testid="operator-progress"
                        />
                    )}
            </g>
            <g data-status-icon={status.SUCCEEDED}>
                <path fillRule="evenodd" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z" />
            </g>
            <g data-status-icon={status.FAILED}>
                <path fillRule="evenodd" d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z" />
            </g>
            <g data-status-icon={status.SKIPPED}>
                <path fillRule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm11.333-2.167a.825.825 0 0 0-1.166-1.166l-5.5 5.5a.825.825 0 0 0 1.166 1.166Z" />
            </g>
        </>
    );
}

export { createProfileLayoutConfig };

/// The progress of a fragment on its contour: the completed share of its work while it runs. Null without known work.
function fragmentProgress(execution: ProfileExecutionState, fragment: number): { percent: number | null } | null {
    const state = execution.fragments[fragment];
    const work = workOf(state);
    if (state == null || work == null) return null;
    const running = state.status === dashql.buffers.profile.ProfileExecutionStatus.RUNNING;
    return { percent: running ? Math.round((work.done / work.total) * 100) : null };
}

/// The metrics of a fragment next to its contour, e.g. `7.53M rows · 242 kB · 4.17 s CPU · 12/37 splits`: the
/// processed rows and bytes and the CPU time as far as reported, and the splits until the fragment succeeded.
/// A metric that is still 0 says nothing yet and is left out, Trino reports no bytes for some connectors at all. The
/// rows of a succeeded fragment stay, it read none. Null without any metric.
export function formatFragmentMetrics(state: ProfileEntityState | null | undefined): { text: string; description: string } | null {
    if (state == null) return null;
    const field = dashql.buffers.profile.ProfileStatsField;
    const succeeded = state.status === dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED;
    const text: string[] = [];
    const description: string[] = [];
    const rows = stat(state, field.TUPLES_IN, s => s.tuplesIn);
    if (rows != null && (rows > 0 || succeeded)) {
        text.push(`${formatCompactCount(rows)} rows`);
        description.push(`${rows} rows`);
    }
    const bytes = stat(state, field.BYTES_IN, s => s.bytesIn);
    if (bytes != null && bytes > 0) {
        text.push(formatCompactBytes(bytes));
        description.push(formatCompactBytes(bytes));
    }
    const cpu = stat(state, field.CPU_TIME, s => s.cpuTimeUs);
    if (cpu != null && cpu > 0) {
        text.push(`${formatElapsed(cpu / 1000)} CPU`);
        description.push(`${formatElapsed(cpu / 1000)} CPU time`);
    }
    const work = workOf(state);
    if (work != null && !succeeded) {
        text.push(`${formatCompactCount(work.done)}/${formatCompactCount(work.total)} splits`);
        description.push(`${work.done} of ${work.total} splits`);
    }
    return text.length === 0 ? null : { text: text.join(' · '), description: description.join(', ') };
}

/// The progress of an operator: the completed share of the work of its fragment while it runs, null without
/// completed work. Trino completes the splits of a stage that reads other stages only at its end, the operator
/// spins until then.
function operatorProgress(execution: ProfileExecutionState, fragment: number): number | null {
    const percent = fragmentProgress(execution, fragment)?.percent ?? null;
    return percent == null || percent === 0 ? null : percent;
}

/// The status of a fragment as attribute value for the contour, undefined without execution state
function fragmentStatus(execution: ProfileExecutionState, fragment: number): string | undefined {
    const status = execution.fragments[fragment]?.status;
    switch (status) {
        case dashql.buffers.profile.ProfileExecutionStatus.PENDING: return 'pending';
        case dashql.buffers.profile.ProfileExecutionStatus.RUNNING: return 'running';
        case dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED: return 'succeeded';
        case dashql.buffers.profile.ProfileExecutionStatus.FAILED: return 'failed';
        case dashql.buffers.profile.ProfileExecutionStatus.SKIPPED: return 'skipped';
        default: return undefined;
    }
}

export interface QueryProfileViewProps {
    /// The plan structure
    plan: dashql.FlatBufferPtr<dashql.buffers.profile.QueryProfile>;
    /// The execution state (the rows of an analyzed plan, the progress of a running query)
    execution?: ProfileExecutionState;
    showProgress?: boolean;
    controllerRef?: React.RefObject<ProfileExecutionController | null>;
    autoFocus?: boolean;
    /// Fill the height of the container instead of picking a height of its own
    fill?: boolean;
    edgeRendering?: ProfileEdgeRenderingConfig;
    /// Lay out the plan again with the other orientation, the view shows a rotate button with it
    onRotate?: () => void;
    dependencies?: QueryProfileViewDependencies;
}

export interface QueryProfileViewDependencies {
    materializeProfileScene: typeof materializeProfileScene;
}

const DEFAULT_DEPENDENCIES: QueryProfileViewDependencies = {
    materializeProfileScene,
};

export type ProfileEdgeColorScheme = (value: number) => string;
export const PROFILE_EDGE_COLOR_SCHEME_PU_OR: ProfileEdgeColorScheme = interpolatePuOr;
export const PROFILE_EDGE_COLOR_SCHEME_BR_BG: ProfileEdgeColorScheme = interpolateBrBG;
export const PROFILE_EDGE_COLOR_SCHEME_RD_BU: ProfileEdgeColorScheme = value => interpolateRdBu(1 - value);
export const PROFILE_EDGE_COLOR_SCHEME_RD_PU: ProfileEdgeColorScheme = interpolateRdPu;
export const PROFILE_COST_COLOR_SCHEME_OR_RD: ProfileEdgeColorScheme = interpolateOrRd;

export interface ProfileEdgeRenderingConfig {
    colorScheme?: ProfileEdgeColorScheme;
    rowColorScheme?: ProfileEdgeColorScheme;
    /// The scale of the CPU and memory annotations, from none to the most of all operators
    costColorScheme?: ProfileEdgeColorScheme;
}

interface ProfileEdgeBadge {
    x: number;
    y: number;
    width: number;
    text: string;
    background: string;
    foreground: string;
    /// The border, the default border if null
    border: string | null;
    description: string;
}

/// An annotation in the slot of an operator: the badge of the edge to its parent or of the operator itself
interface ProfileAnnotation {
    operator: number;
    edge: ProfileSceneEdge | null;
    badge: ProfileEdgeBadge;
}

function contrastingTextColor(background: string): string {
    const rgb = parseColor(background)?.rgb();
    if (rgb == null) return '#000000';
    const linear = [rgb.r, rgb.g, rgb.b].map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance > 0.179 ? '#000000' : '#ffffff';
}

function formatRelativeDifference(difference: number): string {
    const percentage = Math.round(difference * 100);
    if (percentage > 200) return '>200%';
    if (percentage < -200) return '<-200%';
    return `${percentage > 0 ? '+' : ''}${percentage}%`;
}

export function formatEstimateSymbol(difference: number, absoluteDifference = Number.POSITIVE_INFINITY): string {
    if (difference === 0) return '=';
    if (absoluteDifference <= ESTIMATE_APPROXIMATE_ROW_THRESHOLD) return '~';
    if (difference <= -0.5) return '>>';
    if (difference <= -0.1) return '>';
    if (difference < 0) return '~';
    if (difference < 0.1) return '~';
    if (difference < 0.5) return '<';
    return '<<';
}

/// The CPU share of an operator in the annotation, e.g. `38%`, `<1%`
export function formatCpuShare(share: number): string {
    if (share === 0) return '0%';
    if (share < 0.01) return '<1%';
    return `${Math.round(share * 100)}%`;
}

/// The bytes of an operator in the annotation, at most 4 characters, e.g. `980B`, `12K`, `1.2M`, `340G`
export function formatShortBytes(bytes: number): string {
    if (bytes < 1000) return `${Math.round(bytes)}B`;
    const units = ['K', 'M', 'G', 'T', 'P'];
    let value = bytes / 1000;
    let unit = 0;
    // Round first, 999.6K is 1.0M
    while (Number(value.toPrecision(2)) >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit += 1;
    }
    return `${Number(value.toPrecision(2))}${units[unit]}`;
}

const ROW_COUNT_FORMAT = new Intl.NumberFormat('en-US');

function formatRowCount(value: number): string {
    return ROW_COUNT_FORMAT.format(value);
}

/// The left end of the annotation slot of an operator, vertically centered. The slot follows the left padding of the
/// operator, in place of the status icon.
export function placeOperatorAnnotation(
    operator: Pick<ProfileSceneOperator, 'rect'>,
    input: Pick<dashql.buffers.profile.ProfileLayoutConfigT, 'nodePaddingLeft'>,
): { x: number; y: number } {
    return { x: operator.rect.x - operator.rect.width / 2 + input.nodePaddingLeft, y: operator.rect.y };
}

export function QueryProfileView({ plan, execution = ProfileExecutionState.EMPTY, showProgress = false, controllerRef, autoFocus = false, fill = false, edgeRendering, onRotate, dependencies = DEFAULT_DEPENDENCIES }: QueryProfileViewProps) {
    const scene = React.useMemo(() => dependencies.materializeProfileScene(plan), [dependencies, plan]);
    const ownController = React.useRef<ProfileExecutionController | null>(null);
    ownController.current ??= new ProfileExecutionController();
    const controller = controllerRef?.current ?? ownController.current;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const sceneRef = React.useRef<SVGGElement | null>(null);
    const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const transformRef = React.useRef<ZoomTransform>(zoomIdentity);
    const [selection, setSelection] = React.useState<{ operator: ProfileSceneOperator; anchor: SVGGElement } | null>(null);
    const [inspectorOpen, setInspectorOpen] = React.useState(false);
    const [selectedAnnotationMode, setAnnotationMode] = React.useState<ProfileAnnotationMode | null>(null);
    /// The fragments are light grey, unless the colors tell them apart
    const [fragmentColors, setFragmentColors] = React.useState(false);
    const operatorRefs = React.useRef(new Map<number, SVGGElement>());
    const [positionRevision, setPositionRevision] = React.useState(0);
    const edgeColorScheme = edgeRendering?.colorScheme ?? PROFILE_EDGE_COLOR_SCHEME_RD_BU;
    const rowColorScheme = edgeRendering?.rowColorScheme ?? PROFILE_EDGE_COLOR_SCHEME_RD_PU;
    const costColorScheme = edgeRendering?.costColorScheme ?? PROFILE_COST_COLOR_SCHEME_OR_RD;
    const edgeDifferenceColor = React.useCallback(
        (difference: number) => edgeColorScheme(difference < 0
            ? Math.max(0, (difference + 1) / 2)
            : Math.min(1, 0.5 + difference / 4)),
        [edgeColorScheme],
    );
    const estimateLegendGradient = React.useMemo(
        () => Array.from({ length: 11 }, (_, index) => edgeColorScheme(1 - index / 10)).join(', '),
        [edgeColorScheme],
    );
    const rowLegendGradient = React.useMemo(
        () => Array.from({ length: 11 }, (_, index) => rowColorScheme(index / 10)).join(', '),
        [rowColorScheme],
    );
    const costLegendGradient = React.useMemo(
        () => Array.from({ length: 11 }, (_, index) => costColorScheme(index / 10)).join(', '),
        [costColorScheme],
    );
    const actualRows = React.useMemo(() => scene.edges.map(edge => {
        const rows = execution.edgeRows(edge.slot, edge.childOperator);
        return rows == null ? null : Number(rows);
    }), [scene, execution]);
    // A mode is offered only if some operator has its value, a plan without estimates has no Estimates and no Accuracy
    const annotationModes = React.useMemo(() => {
        const field = dashql.buffers.profile.ProfileStatsField;
        const hasActual = actualRows.some(rows => rows != null);
        const hasEstimate = scene.edges.some(edge => edge.outputCardinalityEstimated != null);
        const hasBoth = scene.edges.some((edge, index) => edge.outputCardinalityEstimated != null && actualRows[index] != null);
        const reports = (stat: dashql.buffers.profile.ProfileStatsField) =>
            scene.operators.some(operator => {
                const state = execution.operators[operator.id];
                return state != null && isStatReported(state.stats, stat);
            });
        const available: Record<ProfileAnnotationMode, boolean> = {
            status: showProgress,
            plain: true,
            rows: hasActual,
            estimates: hasEstimate,
            accuracy: hasBoth,
            cpu: reports(field.CPU_TIME),
            memory: reports(field.MEMORY_BYTES),
        };
        return PROFILE_ANNOTATION_MODES.filter(({ mode }) => available[mode]);
    }, [scene, execution, actualRows, showProgress]);
    // Without a choice, or if the chosen mode is gone, the view shows the status with progress, else the actual rows,
    // else the estimates
    const offered = (mode: ProfileAnnotationMode) => annotationModes.some(m => m.mode === mode);
    const annotationMode: ProfileAnnotationMode = selectedAnnotationMode != null && offered(selectedAnnotationMode)
        ? selectedAnnotationMode
        : (['status', 'rows', 'estimates'] as const).find(offered) ?? 'plain';
    const annotations: ProfileAnnotation[] = React.useMemo(() => {
        const field = dashql.buffers.profile.ProfileStatsField;
        const badge = (operator: ProfileSceneOperator, text: string, background: string, description: string, border: string | null = null): ProfileEdgeBadge => ({
            ...placeOperatorAnnotation(operator, scene.layoutConfig.input!),
            width: Math.min(
                PROFILE_OPERATOR_ANNOTATION_WIDTH,
                Math.max(OPERATOR_ANNOTATION_MIN_WIDTH, text.length * OPERATOR_ANNOTATION_CHAR_WIDTH + OPERATOR_ANNOTATION_PADDING),
            ),
            text,
            background,
            foreground: contrastingTextColor(background),
            border,
            description,
        });
        switch (annotationMode) {
            case 'rows':
            case 'estimates':
            case 'accuracy':
                break;
            case 'cpu': {
                // The share of the CPU time of all operators, colored relative to the operator with the most
                const cpu = scene.operators.map(operator => stat(execution.operators[operator.id], field.CPU_TIME, s => s.cpuTimeUs));
                const total = cpu.reduce<number>((sum, value) => sum + (value ?? 0), 0);
                const max = cpu.reduce<number>((maximum, value) => Math.max(maximum, value ?? 0), 0);
                return scene.operators.flatMap((operator, index) => {
                    const value = cpu[index];
                    if (value == null) return [];
                    const share = total === 0 ? 0 : value / total;
                    return [{
                        operator: operator.id,
                        edge: null,
                        badge: badge(
                            operator,
                            formatCpuShare(share),
                            costColorScheme(max === 0 ? 0 : value / max),
                            `CPU ${formatElapsed(value / 1000)}, ${formatCpuShare(share)} of the CPU time of all operators`,
                        ),
                    }];
                });
            }
            case 'memory': {
                const memory = scene.operators.map(operator => stat(execution.operators[operator.id], field.MEMORY_BYTES, s => s.memoryBytes));
                const max = memory.reduce<number>((maximum, value) => Math.max(maximum, value ?? 0), 0);
                return scene.operators.flatMap((operator, index) => {
                    const value = memory[index];
                    if (value == null) return [];
                    const spilledBytes = stat(execution.operators[operator.id], field.SPILLED_BYTES, s => s.spilledBytes) ?? 0;
                    return [{
                        operator: operator.id,
                        edge: null,
                        badge: badge(
                            operator,
                            formatShortBytes(value),
                            costColorScheme(max === 0 ? 0 : value / max),
                            `Memory ${formatCompactBytes(value)}${spilledBytes > 0 ? `, spilled ${formatCompactBytes(spilledBytes)} to disk` : ''}`,
                            spilledBytes > 0 ? SPILLED_BADGE_BORDER : null,
                        ),
                    }];
                });
            }
            default:
                return [];
        }
        // Actual and estimated rows share one color scale, the same color is the same row count in both modes
        const maxRowValue = scene.edges.reduce(
            (maximum, edge, edgeIndex) => Math.max(maximum, actualRows[edgeIndex] ?? 0, edge.outputCardinalityEstimated ?? 0),
            0,
        );
        const rowScale = (rows: number) => maxRowValue === 0 ? 0 : Math.log1p(rows) / Math.log1p(maxRowValue);
        return scene.edges.flatMap((edge, edgeIndex) => {
            const child = scene.operators[edge.childOperator];
            if (child == null || scene.operators[edge.parentOperator] == null) return [];
            const actual = actualRows[edgeIndex];
            const estimated = edge.outputCardinalityEstimated;
            let annotation: ProfileEdgeBadge | null = null;
            if (annotationMode === 'rows' && actual != null) {
                annotation = badge(child, formatCompactCount(actual), rowColorScheme(rowScale(actual)), `Actual rows ${formatRowCount(actual)}`);
            } else if (annotationMode === 'estimates' && estimated != null) {
                annotation = badge(child, formatCompactCount(estimated), rowColorScheme(rowScale(estimated)), `Estimated rows ${formatRowCount(Math.round(estimated))}`);
            } else if (annotationMode === 'accuracy' && actual != null && estimated != null) {
                const difference = estimateRelativeDifference(estimated, actual);
                annotation = badge(
                    child,
                    formatEstimateSymbol(difference, Math.abs(actual - estimated)),
                    edgeDifferenceColor(difference),
                    `Actual rows ${formatRowCount(actual)}, estimated rows ${formatRowCount(Math.round(estimated))}, difference ${formatRelativeDifference(difference)}`,
                );
            }
            return annotation == null ? [] : [{ operator: child.id, edge, badge: annotation }];
        });
    }, [scene, execution, actualRows, annotationMode, rowColorScheme, costColorScheme, edgeDifferenceColor]);
    /// Did an operator spill to disk? The memory legend explains the border then.
    const spilled = React.useMemo(
        () => annotationMode === 'memory' && annotations.some(annotation => annotation.badge.border != null),
        [annotationMode, annotations],
    );
    /// The width of what the annotation slot of an operator shows, the label is centered in the rest of the operator
    const annotationWidths = React.useMemo(() => {
        const widths = new Map<number, number>();
        for (const annotation of annotations) widths.set(annotation.operator, annotation.badge.width);
        return widths;
    }, [annotations]);
    const highlightedEdges = React.useMemo(() => {
        const operatorId = selection?.operator.id;
        return operatorId == null
            ? []
            : scene.edges.filter(edge => edge.childOperator === operatorId || edge.parentOperator === operatorId);
    }, [scene.edges, selection?.operator.id]);
    const highlightedEdgeSet = React.useMemo(() => new Set(highlightedEdges), [highlightedEdges]);
    const highlightedCrossEdges = React.useMemo(() => {
        const operatorId = selection?.operator.id;
        return operatorId == null
            ? []
            : scene.crossEdges.filter(edge => edge.sourceOperator === operatorId || edge.targetOperator === operatorId);
    }, [scene.crossEdges, selection?.operator.id]);
    const highlightedOutputPortOperatorIds = React.useMemo(() => new Set([
        ...highlightedEdges.map(edge => edge.childOperator),
        ...highlightedCrossEdges.map(edge => edge.sourceOperator),
    ]), [highlightedCrossEdges, highlightedEdges]);
    const highlightedInputPortOperatorIds = React.useMemo(() => new Set([
        ...highlightedEdges.map(edge => edge.parentOperator),
        ...highlightedCrossEdges.map(edge => edge.targetOperator),
    ]), [highlightedCrossEdges, highlightedEdges]);
    const crossEdgeDescriptions = React.useMemo(() => {
        const relationships = new Map<number, string[]>();
        const add = (operatorId: number, relationship: string) => {
            const existing = relationships.get(operatorId);
            if (existing == null) relationships.set(operatorId, [relationship]);
            else existing.push(relationship);
        };
        for (const edge of scene.crossEdges) {
            add(edge.sourceOperator, `provides ${edge.kind} to ${scene.operators[edge.targetOperator]?.label ?? 'operator'}`);
            if (edge.targetOperator !== edge.sourceOperator) add(edge.targetOperator, `uses ${edge.kind} from ${scene.operators[edge.sourceOperator]?.label ?? 'operator'}`);
        }
        const descriptions = new Map<number, string>();
        for (const [operatorId, operatorRelationships] of relationships) {
            descriptions.set(operatorId, `; ${operatorRelationships.join('; ')}`);
        }
        return descriptions;
    }, [scene.crossEdges, scene.operators]);

    React.useLayoutEffect(() => {
        controller.reset(scene.operators.length, scene.pipelines.length);
        controller.applyState(execution, scene.operators.map(operator => operator.fragment));
        if (controllerRef != null) controllerRef.current = controller;
        return () => {
            if (controllerRef != null) controllerRef.current = null;
        };
    }, [controller, controllerRef, scene, execution]);

    React.useLayoutEffect(() => {
        if (autoFocus) viewportRef.current?.focus();
    }, [autoFocus]);

    const fit = React.useCallback((animate = false) => {
        const viewport = viewportRef.current;
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (viewport == null || svg == null || behavior == null) return;
        const bounds = measurePlanBounds(sceneRef.current, scene);
        if (bounds.width <= 0 || bounds.height <= 0) return;
        const { x, y, scale } = computeProfileFitTransform(bounds, viewport.clientWidth, viewport.clientHeight);
        // A large plan fits below the default zoom limit, allow zooming out as far as the fit
        behavior.scaleExtent([Math.min(PROFILE_MIN_ZOOM, scale), PROFILE_MAX_ZOOM]);
        const target = zoomIdentity.translate(x, y).scale(scale);
        const targetSelection = animate ? select(svg).transition().duration(160) : select(svg);
        targetSelection.call(behavior.transform as any, target);
    }, [scene]);

    // The zoom transform is applied to the DOM directly. Only the open inspector depends on the
    // operator positions, so bump its position revision at most once per frame and only while it is open.
    const inspectorVisibleRef = React.useRef(false);
    inspectorVisibleRef.current = selection != null && inspectorOpen;
    const positionRevisionFrame = React.useRef<number | null>(null);
    const schedulePositionRevision = React.useCallback(() => {
        if (positionRevisionFrame.current != null) return;
        positionRevisionFrame.current = requestAnimationFrame(() => {
            positionRevisionFrame.current = null;
            setPositionRevision(value => value + 1);
        });
    }, []);
    React.useEffect(() => () => {
        if (positionRevisionFrame.current != null) {
            cancelAnimationFrame(positionRevisionFrame.current);
            positionRevisionFrame.current = null;
        }
    }, []);

    React.useLayoutEffect(() => {
        const svg = svgRef.current;
        const viewport = viewportRef.current;
        if (svg == null || viewport == null) return;
        const behavior = zoom<SVGSVGElement, unknown>()
            // The default extent reads the relative SVG width, which throws while the SVG is not laid out yet
            .extent((): [[number, number], [number, number]] => [[0, 0], [viewport.clientWidth, viewport.clientHeight]])
            .scaleExtent([PROFILE_MIN_ZOOM, PROFILE_MAX_ZOOM])
            .clickDistance(4)
            .filter(event => !event.button && !(event.target instanceof Element && event.target.closest('button')))
            .on('zoom', event => {
                transformRef.current = event.transform;
                sceneRef.current?.setAttribute('transform', event.transform.toString());
                if (inspectorVisibleRef.current) schedulePositionRevision();
            });
        zoomRef.current = behavior;
        select(svg).call(behavior).on('dblclick.zoom', null);
        // Re-fit when the viewport is resized, e.g. when the surrounding card is expanded.
        // The zoom event of the fit also repositions an open inspector.
        const observer = new ResizeObserver(() => fit());
        observer.observe(viewport);
        fit();
        return () => {
            observer.disconnect();
            select(svg).on('.zoom', null);
            zoomRef.current = null;
        };
    }, [fit, schedulePositionRevision]);

    const zoomBy = React.useCallback((factor: number) => {
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (svg != null && behavior != null) select(svg).transition().duration(120).call(behavior.scaleBy, factor);
    }, []);

    // The rotated plan has other operator positions, the selection and the inspector are dropped.
    // The new scene fits itself into the viewport.
    const rotate = React.useMemo(() => onRotate == null ? null : () => {
        setInspectorOpen(false);
        setSelection(null);
        onRotate();
    }, [onRotate]);


    const onKeyDown = React.useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && inspectorOpen) {
            setInspectorOpen(false);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const targetIsViewport = event.target === viewportRef.current;
        const targetIsOperator = event.target instanceof Element && event.target.matches('[data-plan-operator-id]');
        if (!targetIsViewport && !targetIsOperator) return;

        const direction: ProfileNavigationDirection | null = event.key === 'ArrowLeft' ? 'left'
            : event.key === 'ArrowRight' ? 'right'
                : event.key === 'ArrowUp' ? 'up'
                    : event.key === 'ArrowDown' ? 'down'
                        : null;
        if (direction != null) {
            const targetOperatorId = targetIsOperator
                ? Number((event.target as Element).getAttribute('data-plan-operator-id'))
                : null;
            const current = targetOperatorId == null
                ? selection?.operator ?? null
                : scene.operators.find(operator => operator.id === targetOperatorId) ?? null;
            const next = findProfileOperatorInDirection(scene.operators, scene.edges, current, direction, scene.leftToRight);
            const anchor = next == null ? null : operatorRefs.current.get(next.id) ?? null;
            if (next != null && anchor != null) {
                setSelection({ operator: next, anchor });
                setPositionRevision(value => value + 1);
                anchor.focus();
            }
        } else if (event.key === '+' || event.key === '=') zoomBy(1.25);
        else if (event.key === '-') zoomBy(0.8);
        else if (event.key === 'f') fit(true);
        else if (event.key === 'r' && rotate != null) rotate();
        else return;
        event.preventDefault();
        event.stopPropagation();
    }, [fit, inspectorOpen, rotate, scene.operators, selection?.operator, zoomBy]);

    // Stable operator callbacks so that the memoized operator nodes only re-render when their own props change
    const selectionRef = React.useRef(selection);
    selectionRef.current = selection;
    const setOperatorAnchor = React.useCallback((operatorId: number, anchor: SVGGElement | null) => {
        if (anchor == null) operatorRefs.current.delete(operatorId);
        else operatorRefs.current.set(operatorId, anchor);
    }, []);
    const onFocusOperator = React.useCallback((selected: ProfileSceneOperator, anchor: SVGGElement) => {
        setSelection({ operator: selected, anchor });
    }, []);
    const onSelectOperator = React.useCallback((selected: ProfileSceneOperator, anchor: SVGGElement, toggle: boolean) => {
        const previous = selectionRef.current;
        setSelection({ operator: selected, anchor });
        setPositionRevision(value => value + 1);
        setInspectorOpen(open => toggle && previous?.operator.id === selected.id ? !open : true);
    }, []);

    const anchorRef = React.useMemo(() => ({ current: selection?.anchor ?? null }), [selection?.anchor]);
    // The legend goes where a plan leaves space: top left above a top-down plan, bottom left above the
    // annotation controls below a left-to-right plan
    const legend = annotationMode === 'rows' || annotationMode === 'estimates' ? (
        <div
            className={styles.edge_legend}
            role="img"
            data-testid="plan-rows-legend"
            aria-label="Badge color encodes row count from fewer rows on the left to more rows on the right"
        >
            <div className={styles.edge_legend_scale}>
                <span>Fewer rows</span>
                <span>More rows</span>
                <i
                    aria-hidden="true"
                    style={{ backgroundImage: `linear-gradient(to right, ${rowLegendGradient})` }}
                />
            </div>
        </div>
    ) : annotationMode === 'cpu' || annotationMode === 'memory' ? (
        <div
            className={styles.edge_legend}
            role="img"
            data-testid={`plan-${annotationMode}-legend`}
            aria-label={annotationMode === 'cpu'
                ? 'Badges show the share of the CPU time of all operators, the color goes from none on the left to the operator with the most CPU time on the right'
                : `Badges show the memory of an operator, the color goes from none on the left to the operator with the most memory on the right${spilled ? ', an orange border marks an operator that spilled to disk' : ''}`}
        >
            <div className={styles.edge_legend_scale}>
                <span>{annotationMode === 'cpu' ? 'Less CPU' : 'Less memory'}</span>
                <span>{annotationMode === 'cpu' ? 'More CPU' : 'More memory'}</span>
                <i
                    aria-hidden="true"
                    style={{ backgroundImage: `linear-gradient(to right, ${costLegendGradient})` }}
                />
                {spilled && <span className={styles.edge_legend_note} style={{ borderColor: SPILLED_BADGE_BORDER }}>Spilled to disk</span>}
            </div>
        </div>
    ) : annotationMode === 'accuracy' ? (
        <div
            className={styles.edge_legend}
            role="img"
            data-testid="plan-accuracy-legend"
            aria-label="Badge color compares actual rows with estimates: red on the left means underestimated, the center means matched, and blue on the right means overestimated; differences are capped at 200 percent"
        >
            <div className={styles.edge_legend_scale}>
                <span>Underestimated</span>
                <span>Overestimated</span>
                <i
                    aria-hidden="true"
                    data-testid="plan-legend-gradient"
                    style={{ backgroundImage: `linear-gradient(to right, ${estimateLegendGradient})` }}
                />
                <span className={styles.edge_legend_matched}>Matched</span>
            </div>
        </div>
    ) : null;
    return (
        <div
            ref={viewportRef}
            className={styles.viewport}
            data-fill={fill || undefined}
            role="region"
            aria-label={`Query execution plan with ${scene.operators.length} operators`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-electron-drag-region="false"
        >
            <svg ref={svgRef} className={styles.svg} onClick={event => {
                if (event.target === svgRef.current) {
                    setSelection(null);
                    setInspectorOpen(false);
                }
            }}>
                <g ref={sceneRef}>
                    <g>
                        {scene.fragments.map((fragment, fragmentIndex) => {
                            const progress = showProgress ? fragmentProgress(execution, fragment.id) : null;
                            // The metrics of a fragment are only read out, they have no card on the contour for now
                            const metrics = showProgress ? formatFragmentMetrics(execution.fragments[fragment.id]) : null;
                            return (
                                <g
                                    key={fragment.id}
                                    className={graphStyles.fragment_colors}
                                    data-color={fragmentColors ? fragmentIndex % 6 : 'neutral'}
                                    role="img"
                                    aria-label={`Fragment ${fragment.id + 1}${metrics == null ? '' : `, ${metrics.description}`}, containing operators: ${fragment.operatorIds
                                        .map(operatorId => scene.operators[operatorId]?.label)
                                        .filter((label): label is string => label != null)
                                        .join(', ')}`}
                                >
                                    <path
                                        className={`${graphStyles.fragment} ${styles.fragment}`}
                                        d={fragment.path}
                                        data-status={fragmentStatus(execution, fragment.id)}
                                    />
                                    {progress?.percent != null && (
                                        // The completed share of the work runs along the contour
                                        <path
                                            className={styles.fragment_progress}
                                            d={fragment.path}
                                            pathLength={100}
                                            strokeDasharray={`${progress.percent} 100`}
                                            data-testid="fragment-progress"
                                        />
                                    )}
                                </g>
                            );
                        })}
                    </g>
                    <g>
                        {scene.pipelines.map(pipeline => (
                            <path
                                key={pipeline.id}
                                ref={path => controller.registerPipeline(pipeline.id, path)}
                                className={styles.pipeline}
                                d={pipeline.path}
                                aria-hidden="true"
                            />
                        ))}
                    </g>
                    <g aria-hidden="true">
                        {scene.edges.map(edge => (
                            <path
                                key={edge.id.toString()}
                                className={graphStyles.edge}
                                d={edge.path}
                                style={{ strokeWidth: EDGE_WIDTH }}
                                data-plan-edge-id={edge.id.toString()}
                            />
                        ))}
                    </g>
                    <g aria-hidden="true">
                        {scene.crossEdges.map(edge => (
                            <path
                                key={edge.id.toString()}
                                className={graphStyles.crossEdge}
                                data-kind={edge.kind}
                                d={edge.path}
                            />
                        ))}
                    </g>
                    <g className={graphStyles.edgeHighlightLayer} aria-hidden="true">
                        {highlightedEdges.map(edge => (
                            <path
                                key={`edge-${edge.id}`}
                                className={graphStyles.edgeHighlight}
                                d={edge.path}
                                style={{ strokeWidth: EDGE_WIDTH }}
                                data-plan-edge-highlight-id={edge.id.toString()}
                            />
                        ))}
                        {highlightedCrossEdges.map(edge => (
                            <path
                                key={`cross-edge-${edge.id}`}
                                className={graphStyles.crossEdgeHighlight}
                                d={edge.path}
                                data-plan-cross-edge-highlight-id={edge.id.toString()}
                            />
                        ))}
                    </g>
                    <g>
                        {scene.operators.map(operator => (
                            <ProfileOperatorNode
                                key={operator.id}
                                operator={operator}
                                scene={scene}
                                showStatus={showProgress && annotationMode === 'status'}
                                annotationWidth={showProgress && annotationMode === 'status'
                                    ? STATUS_ICON_SIZE
                                    : annotationWidths.get(operator.id) ?? 0}
                                progress={showProgress ? operatorProgress(execution, operator.fragment) : null}
                                selected={selection?.operator.id === operator.id}
                                highlightedOutputPort={highlightedOutputPortOperatorIds.has(operator.id)}
                                highlightedInputPort={highlightedInputPortOperatorIds.has(operator.id)}
                                expanded={inspectorOpen && selection?.operator.id === operator.id}
                                controller={controller}
                                relationshipDescription={crossEdgeDescriptions.get(operator.id) ?? ''}
                                setAnchor={setOperatorAnchor}
                                onFocus={onFocusOperator}
                                onSelect={onSelectOperator}
                            />
                        ))}
                    </g>
                    {/* The annotations sit in the annotation slots of the operators, above their frames */}
                    <g className={graphStyles.edgeBadgeLayer}>
                        {annotations.map(({ operator, edge, badge }) => {
                            // An edge annotation is highlighted with its edge, an operator annotation with its operator
                            const highlighted = edge != null ? highlightedEdgeSet.has(edge) : selection?.operator.id === operator;
                            return (
                                <g
                                    key={edge != null ? `edge-${edge.id}` : `operator-${operator}`}
                                    className={graphStyles.edgeBadge}
                                    transform={`translate(${badge.x}, ${badge.y})`}
                                    role="img"
                                    aria-label={badge.description}
                                    data-plan-edge-badge-id={edge?.id.toString()}
                                    data-plan-operator-badge-id={edge == null ? operator.toString() : undefined}
                                    data-spilled={badge.border != null || undefined}
                                    data-highlighted={highlighted || undefined}
                                >
                                    <rect
                                        x={0}
                                        y={-OPERATOR_ANNOTATION_HEIGHT / 2}
                                        width={badge.width}
                                        height={OPERATOR_ANNOTATION_HEIGHT}
                                        rx={OPERATOR_ANNOTATION_HEIGHT / 2}
                                        fill={badge.background}
                                        strokeWidth={badge.border != null ? 1.5 : undefined}
                                        style={{
                                            fill: highlighted ? EDGE_HIGHLIGHT_COLOR : undefined,
                                            stroke: highlighted ? EDGE_HIGHLIGHT_COLOR : badge.border ?? EDGE_BADGE_BORDER,
                                        }}
                                    />
                                    <text
                                        x={badge.width / 2}
                                        fill={badge.foreground}
                                        style={highlighted ? { fill: EDGE_HIGHLIGHT_TEXT_COLOR } : undefined}
                                    >
                                        {badge.text}
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                </g>
            </svg>
            <div className={styles.metric_controls}>
                {scene.leftToRight && legend}
                <div className={styles.view_controls}>
                    <SegmentedControl
                        aria-label="Plan annotations"
                        size={SegmentedControlSize.Tiny}
                        onChange={index => setAnnotationMode(annotationModes[index].mode)}
                    >
                        {annotationModes.map(({ mode, label }) => (
                            <SegmentedControl.Button key={mode} data-testid={`plan-annotation-${mode}`} selected={annotationMode === mode}>{label}</SegmentedControl.Button>
                        ))}
                    </SegmentedControl>
                    <ButtonGroup className={styles.view_buttons} aria-label="Plan view controls">
                        {rotate != null && (
                            <IconButton
                                variant={ButtonVariant.Default}
                                size={ButtonSize.Tiny}
                                aria-label={scene.leftToRight ? 'Rotate plan to top-down' : 'Rotate plan to left-to-right'}
                                data-testid="plan-rotate"
                                onClick={rotate}
                            >
                                <RotateIcon size={12} />
                            </IconButton>
                        )}
                        <IconButton
                            variant={ButtonVariant.Default}
                            size={ButtonSize.Tiny}
                            aria-label="Color the fragments"
                            aria-pressed={fragmentColors}
                            data-testid="plan-fragment-colors"
                            onClick={() => setFragmentColors(value => !value)}
                        >
                            <PaintbrushIcon size={12} />
                        </IconButton>
                    </ButtonGroup>
                </div>
            </div>
            {!scene.leftToRight && legend}
            <ButtonGroup className={styles.controls} aria-label="Plan zoom controls">
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><ZoomInIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom out" onClick={() => zoomBy(0.8)}><ZoomOutIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Fit plan" onClick={() => fit(true)}><FitIcon size={12} /></IconButton>
            </ButtonGroup>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={anchorRef}
                open={selection != null && inspectorOpen}
                onClose={() => setInspectorOpen(false)}
                // A left-to-right plan continues right of an operator, the inspector goes above it instead
                side={scene.leftToRight ? AnchorSide.OutsideTop : AnchorSide.OutsideRight}
                align={AnchorAlignment.Center}
                anchorOffset={8}
                width={OverlaySize.L}
                maxHeight={OverlaySize.L}
                positionRevision={positionRevision}
            >
                <section className={styles.inspector} data-testid="plan-operator-inspector" aria-label={`${selection?.operator.label ?? 'Operator'} properties`}>
                    <header
                        className={styles.inspector_header}
                        data-single-line={selection?.operator.typeName == null || selection.operator.typeName === selection.operator.label}
                    >
                        <strong>{selection?.operator.label}</strong>
                        {selection?.operator.typeName != null && selection.operator.typeName !== selection.operator.label && (
                            <span>{selection.operator.typeName}</span>
                        )}
                    </header>
                    {selection != null && (
                        <JsonView
                            className={styles.inspector_json}
                            value={selection.operator.properties}
                            collapsed={2}
                            shortenTextAfterLength={100}
                        />
                    )}
                </section>
            </AnchoredOverlay>
        </div>
    );
}

const ProfileOperatorNode = React.memo(function ProfileOperatorNode(props: {
    operator: ProfileSceneOperator;
    scene: ProfileScene;
    /// Show the status icon in the annotation slot?
    showStatus: boolean;
    /// The width of what the annotation slot shows, 0 if it is empty
    annotationWidth: number;
    /// The completed share of the work of the fragment of the operator in percent while it runs, null if unknown
    progress: number | null;
    selected: boolean;
    highlightedOutputPort: boolean;
    highlightedInputPort: boolean;
    expanded: boolean;
    controller: ProfileExecutionController;
    relationshipDescription: string;
    setAnchor: (operatorId: number, anchor: SVGGElement | null) => void;
    onFocus: (operator: ProfileSceneOperator, anchor: SVGGElement) => void;
    onSelect: (operator: ProfileSceneOperator, anchor: SVGGElement, toggle: boolean) => void;
}) {
    const { operator, scene } = props;
    const setAnchor = React.useCallback((anchor: SVGGElement | null) => props.setAnchor(operator.id, anchor), [props.setAnchor, operator.id]);
    const x = operator.rect.x - operator.rect.width / 2;
    const y = operator.rect.y - operator.rect.height / 2;
    const input = scene.layoutConfig.input!;
    // The label fills the rest of the operator right of the annotation, or all of it without an annotation
    const regionStart = input.nodePaddingLeft + (props.annotationWidth > 0 ? props.annotationWidth + input.iconMarginRight : 0);
    const regionEnd = operator.rect.width - input.nodePaddingRight;
    const renderSymbol = shouldRenderProfileOperatorSymbol(operator.kind, operator.typeName, operator.label);
    const symbolName = renderSymbol ? getProfileOperatorSymbol(operator.kind) : null;
    const OperatorSymbol = symbolName != null ? SymbolIcon(symbolName) : null;
    const activate = (event: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>) => {
        if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
        if ('key' in event) event.preventDefault();
        event.stopPropagation();
        props.onSelect(operator, event.currentTarget, 'key' in event);
    };
    return (
        <g
            ref={setAnchor}
            className={styles.operator}
            data-selected={props.selected}
            data-highlighted-output-port={props.highlightedOutputPort}
            data-highlighted-input-port={props.highlightedInputPort}
            data-plan-operator-id={operator.id}
            transform={`translate(${x}, ${y})`}
            role="button"
            tabIndex={0}
            aria-label={`${operator.label}${props.relationshipDescription}, show properties`}
            aria-expanded={props.expanded}
            onClick={activate}
            onFocus={event => props.onFocus(operator, event.currentTarget)}
            onKeyDown={activate}
        >
            <rect
                className={graphStyles.node_frame}
                width={operator.rect.width}
                height={operator.rect.height}
                rx={6}
                ry={6}
                data-plan-operator-frame
            />
            {props.showStatus && (
                <g
                    ref={slot => props.controller.registerOperator(operator.id, slot)}
                    className={styles.status}
                    transform={`translate(${input.nodePaddingLeft}, ${(input.nodeHeight - STATUS_ICON_SIZE) / 2})`}
                    aria-hidden="true"
                >
                    <g transform={`scale(${STATUS_ICON_SIZE / 16})`}>
                        <StatusIcons progress={props.progress} />
                    </g>
                </g>
            )}
            {OperatorSymbol != null
                ? <g className={styles.operator_symbol} transform={`translate(${(regionStart + regionEnd - PROFILE_OPERATOR_SYMBOL_SIZE) / 2}, ${(input.nodeHeight - PROFILE_OPERATOR_SYMBOL_SIZE) / 2})`} aria-hidden="true"><OperatorSymbol size={PROFILE_OPERATOR_SYMBOL_SIZE} /></g>
                // The label is truncated to maxLabelChars and the core sizes the operator for it, no clipping needed
                : <text x={(regionStart + regionEnd) / 2} y={input.nodeHeight / 2 + 5}>{operator.displayLabel}</text>}
            {/* The output faces the parent: above, or left if the plan grows left-to-right */}
            {(operator.ports & PROFILE_OPERATOR_PORT_OUTPUT) !== 0 && (scene.leftToRight
                ? <GraphPort x={0} y={operator.rect.height / 2} side="left" highlighted={props.highlightedOutputPort} data-plan-port="output" />
                : <GraphPort x={operator.rect.width / 2} y={0} side="top" highlighted={props.highlightedOutputPort} data-plan-port="output" />
            )}
            {(operator.ports & PROFILE_OPERATOR_PORT_INPUT) !== 0 && (scene.leftToRight
                ? <GraphPort x={operator.rect.width} y={operator.rect.height / 2} side="right" highlighted={props.highlightedInputPort} data-plan-port="input" />
                : <GraphPort x={operator.rect.width / 2} y={operator.rect.height} side="bottom" highlighted={props.highlightedInputPort} data-plan-port="input" />
            )}
        </g>
    );
});
