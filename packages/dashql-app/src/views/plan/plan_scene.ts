import * as dashql from '@ankoh/dashql-core';
import { U32_MAX } from './numeric_limits.js';
import { buildEdgePathBetweenRectangles, PathBuilder, selectVerticalEdgeType } from '../../ui/graph/graph_edges.js';
import { getPlanOperatorDisplayWidth } from './plan_operator_symbol.js';

export interface PlanSceneRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/// An operator of the plan structure. Execution state lives in `PlanExecutionState`.
export interface PlanSceneOperator {
    id: number;
    kind: dashql.buffers.view.PlanOperatorKind;
    typeName: string | null;
    label: string;
    displayLabel: string;
    rect: PlanSceneRect;
    ports: number;
    /// The estimated output rows, NaN if the plan has no estimate
    estimatedRows: number;
    properties: Record<string, unknown>;
}

export const PLAN_OPERATOR_PORT_OUTPUT = 0b01;
export const PLAN_OPERATOR_PORT_INPUT = 0b10;

export interface PlanSceneEdge {
    id: number;
    childOperator: number;
    parentOperator: number;
    /// The slot of the child that carries the edge (U32_MAX if none), its output is the flow over the edge
    slot: number;
    /// The estimated rows over the edge, 0 if the plan has no estimate
    outputCardinalityEstimated: number;
    path: string;
}

export interface PlanSceneCrossEdge {
    id: number;
    sourceOperator: number;
    targetOperator: number;
    kind: string;
    properties: Record<string, unknown>;
    path: string;
}

export interface PlanScenePipeline {
    id: number;
    operatorIds: readonly number[];
    path: string;
}

export interface PlanSceneFragment {
    id: number;
    operatorIds: readonly number[];
    path: string;
}

export interface PlanScene {
    width: number;
    height: number;
    layoutConfig: dashql.buffers.view.DerivedPlanLayoutConfigT;
    operators: readonly PlanSceneOperator[];
    edges: readonly PlanSceneEdge[];
    crossEdges: readonly PlanSceneCrossEdge[];
    fragments: readonly PlanSceneFragment[];
    pipelines: readonly PlanScenePipeline[];
}

function readString(vm: dashql.buffers.view.PlanViewModel, id: number): string | null {
    return id !== U32_MAX ? vm.stringDictionary(id) : null;
}

function readAttributeRange(
    vm: dashql.buffers.view.PlanViewModel,
    begin: number,
    count: number,
): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const attribute = new dashql.buffers.view.PlanAttribute();
    for (let i = 0; i < count; ++i) {
        const value = vm.attributes(begin + i, attribute);
        if (value == null) continue;
        const name = readString(vm, value.name());
        const json = readString(vm, value.valueJson());
        if (name == null || json == null) continue;
        try {
            properties[name] = JSON.parse(json);
        } catch {
            properties[name] = json;
        }
    }
    return properties;
}

export function estimateRelativeDifference(estimated: number, actual: number): number {
    if (estimated === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
    return (actual - estimated) / Math.abs(estimated);
}

export function buildCrossEdgePath(
    source: PlanSceneRect,
    target: PlanSceneRect,
    minHandleLength = 24,
    minInputHandleLength = 48,
): string {
    const sourceX = source.x;
    const sourceY = source.y - source.height / 2;
    const targetX = target.x;
    const targetY = target.y + target.height / 2;
    const sourceHandleLength = Math.max(minHandleLength, Math.abs(sourceY - targetY) / 2);
    const targetHandleLength = Math.max(minInputHandleLength, sourceHandleLength);
    return `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY - sourceHandleLength}, ${targetX} ${targetY + targetHandleLength}, ${targetX} ${targetY}`;
}

export function truncatePlanLabel(label: string, maxChars: number): string {
    const chars = Array.from(label);
    if (chars.length <= maxChars) return label;
    if (maxChars === 0) return '';
    return `${chars.slice(0, maxChars - 1).join('')}…`;
}

export function buildPipelinePath(operatorIds: readonly number[], operators: readonly Pick<PlanSceneOperator, "rect">[]): string {
    if (operatorIds.length === 0) return '';
    const padding = 4;
    const radius = 8;
    const parts: string[] = [];
    for (const operatorId of operatorIds) {
        const op = operators[operatorId];
        if (op == null) continue;
        const x = op.rect.x - op.rect.width / 2 - padding;
        const y = op.rect.y - op.rect.height / 2 - padding;
        const width = op.rect.width + padding * 2;
        const height = op.rect.height + padding * 2;
        parts.push(`M ${x + radius} ${y} H ${x + width - radius} Q ${x + width} ${y} ${x + width} ${y + radius} V ${y + height - radius} Q ${x + width} ${y + height} ${x + width - radius} ${y + height} H ${x + radius} Q ${x} ${y + height} ${x} ${y + height - radius} V ${y + radius} Q ${x} ${y} ${x + radius} ${y} Z`);
    }
    return parts.join(' ');
}

interface FragmentPoint {
    x: number;
    y: number;
}

interface FragmentSegment {
    from: FragmentPoint;
    to: FragmentPoint;
}

function pointKey(point: FragmentPoint): string {
    return `${point.x},${point.y}`;
}

function segmentDirection(segment: FragmentSegment): number {
    if (segment.to.x > segment.from.x) return 0;
    if (segment.to.y > segment.from.y) return 1;
    if (segment.to.x < segment.from.x) return 2;
    return 3;
}

function selectNextFragmentSegment(
    candidates: readonly FragmentSegment[] | undefined,
    previous: FragmentSegment,
    unused: ReadonlySet<FragmentSegment>,
): FragmentSegment | undefined {
    const previousDirection = segmentDirection(previous);
    const turnPriority = [1, 0, 3, 2];
    for (const turn of turnPriority) {
        const direction = (previousDirection + turn) % 4;
        const candidate = candidates?.find(segment => unused.has(segment) && segmentDirection(segment) === direction);
        if (candidate != null) return candidate;
    }
    return undefined;
}

function renderRoundedFragmentContour(points: readonly FragmentPoint[], radius: number): string {
    const contour = points.length > 1 && pointKey(points[0]) === pointKey(points[points.length - 1])
        ? points.slice(0, -1)
        : points;
    if (contour.length < 3) return '';

    const corners = contour.map((point, index) => {
        const previous = contour[(index + contour.length - 1) % contour.length];
        const next = contour[(index + 1) % contour.length];
        const previousDistance = Math.abs(previous.x - point.x) + Math.abs(previous.y - point.y);
        const nextDistance = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
        const offset = Math.min(radius, previousDistance / 2, nextDistance / 2);
        const entry = {
            x: point.x + Math.sign(previous.x - point.x) * offset,
            y: point.y + Math.sign(previous.y - point.y) * offset,
        };
        const exit = {
            x: point.x + Math.sign(next.x - point.x) * offset,
            y: point.y + Math.sign(next.y - point.y) * offset,
        };
        return { point, entry, exit };
    });

    const first = corners[0];
    const parts = [`M ${first.entry.x} ${first.entry.y}`, `Q ${first.point.x} ${first.point.y} ${first.exit.x} ${first.exit.y}`];
    for (let i = 1; i < corners.length; ++i) {
        const corner = corners[i];
        parts.push(`L ${corner.entry.x} ${corner.entry.y}`);
        parts.push(`Q ${corner.point.x} ${corner.point.y} ${corner.exit.x} ${corner.exit.y}`);
    }
    parts.push('Z');
    return parts.join(' ');
}

function appendFragmentRect(rectangles: PlanSceneRect[], rect: PlanSceneRect, padding: number): void {
    rectangles.push({
        x: rect.x - rect.width / 2 - padding,
        y: rect.y - rect.height / 2 - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
    });
}

function appendFragmentCorridor(
    rectangles: PlanSceneRect[],
    from: PlanSceneRect,
    to: PlanSceneRect,
    width: number,
): void {
    const halfWidth = width / 2;
    const direction = Math.sign(to.y - from.y) || 1;
    const fromY = from.y + direction * from.height / 2;
    const toY = to.y - direction * to.height / 2;
    const midY = (fromY + toY) / 2;
    rectangles.push({
        x: from.x - halfWidth,
        y: Math.min(fromY, midY) - halfWidth,
        width,
        height: Math.abs(midY - fromY) + width,
    });
    rectangles.push({
        x: Math.min(from.x, to.x) - halfWidth,
        y: midY - halfWidth,
        width: Math.abs(to.x - from.x) + width,
        height: width,
    });
    rectangles.push({
        x: to.x - halfWidth,
        y: Math.min(midY, toY) - halfWidth,
        width,
        height: Math.abs(toY - midY) + width,
    });
}

function traceFragmentRectangles(rectangles: readonly PlanSceneRect[]): string {
    if (rectangles.length === 0) return '';
    const xs = Array.from(new Set(rectangles.flatMap(rect => [rect.x, rect.x + rect.width]))).sort((a, b) => a - b);
    const ys = Array.from(new Set(rectangles.flatMap(rect => [rect.y, rect.y + rect.height]))).sort((a, b) => a - b);
    const filled = Array.from({ length: ys.length - 1 }, () => new Uint8Array(xs.length - 1));
    for (const rect of rectangles) {
        const left = xs.indexOf(rect.x);
        const right = xs.indexOf(rect.x + rect.width);
        const top = ys.indexOf(rect.y);
        const bottom = ys.indexOf(rect.y + rect.height);
        for (let y = top; y < bottom; ++y) {
            for (let x = left; x < right; ++x) filled[y][x] = 1;
        }
    }

    const segments: FragmentSegment[] = [];
    const isFilled = (x: number, y: number) => y >= 0 && y < filled.length && x >= 0 && x < filled[y].length && filled[y][x] !== 0;
    for (let y = 0; y < filled.length; ++y) {
        for (let x = 0; x < filled[y].length; ++x) {
            if (!isFilled(x, y)) continue;
            if (!isFilled(x, y - 1)) segments.push({ from: { x: xs[x], y: ys[y] }, to: { x: xs[x + 1], y: ys[y] } });
            if (!isFilled(x + 1, y)) segments.push({ from: { x: xs[x + 1], y: ys[y] }, to: { x: xs[x + 1], y: ys[y + 1] } });
            if (!isFilled(x, y + 1)) segments.push({ from: { x: xs[x + 1], y: ys[y + 1] }, to: { x: xs[x], y: ys[y + 1] } });
            if (!isFilled(x - 1, y)) segments.push({ from: { x: xs[x], y: ys[y + 1] }, to: { x: xs[x], y: ys[y] } });
        }
    }

    const segmentsByStart = new Map<string, FragmentSegment[]>();
    for (const segment of segments) {
        const key = pointKey(segment.from);
        const candidates = segmentsByStart.get(key);
        if (candidates == null) segmentsByStart.set(key, [segment]);
        else candidates.push(segment);
    }

    const parts: string[] = [];
    const unused = new Set(segments);
    while (unused.size > 0) {
        const first = unused.values().next().value!;
        unused.delete(first);
        const start = first.from;
        let previousSegment = first;
        let current = first.to;
        const points = [start, current];
        while (pointKey(current) !== pointKey(start)) {
            const candidates = segmentsByStart.get(pointKey(current));
            const next = selectNextFragmentSegment(candidates, previousSegment, unused);
            if (next == null) break;
            unused.delete(next);
            previousSegment = next;
            current = next.to;
            const previous = points[points.length - 1];
            const beforePrevious = points[points.length - 2];
            if (beforePrevious != null
                && (beforePrevious.x === previous.x && previous.x === current.x
                    || beforePrevious.y === previous.y && previous.y === current.y)) {
                points[points.length - 1] = current;
            } else {
                points.push(current);
            }
        }
        if (pointKey(current) === pointKey(start)) {
            const path = renderRoundedFragmentContour(points, 8);
            if (path.length > 0) parts.push(path);
        }
    }
    return parts.join(' ');
}

export function buildFragmentPath(
    operatorIds: readonly number[],
    operators: readonly Pick<PlanSceneOperator, 'rect'>[],
    edges: readonly Pick<PlanSceneEdge, 'childOperator' | 'parentOperator'>[] = [],
    padding = 12,
    corridorWidth = padding * 2,
): string {
    const rectangles: PlanSceneRect[] = [];
    const memberIds = new Set(operatorIds);
    for (const operatorId of operatorIds) {
        const op = operators[operatorId];
        if (op == null) continue;
        appendFragmentRect(rectangles, op.rect, padding);
    }
    for (const edge of edges) {
        if (!memberIds.has(edge.childOperator) || !memberIds.has(edge.parentOperator)) continue;
        const child = operators[edge.childOperator];
        const parent = operators[edge.parentOperator];
        if (child == null || parent == null) continue;
        appendFragmentCorridor(rectangles, child.rect, parent.rect, corridorWidth);
    }
    return traceFragmentRectangles(rectangles);
}

/// The values of a range of an index vector
function readIndexRange(read: (index: number) => number | null, begin: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; ++i) {
        const value = read(begin + i);
        if (value != null) out.push(value);
    }
    return out;
}

/// Materialize the structure of a plan for rendering. The scene carries no execution state.
export function materializePlanScene(viewModel: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>): PlanScene {
    const vm = viewModel.read();
    const layoutConfig = vm.layoutConfig()!.unpack();
    const input = layoutConfig.input!;
    const operators: PlanSceneOperator[] = new Array(vm.operatorsLength());
    const tmpOperator = new dashql.buffers.view.PlanOperator();
    for (let i = 0; i < vm.operatorsLength(); ++i) {
        const op = vm.operators(i, tmpOperator)!;
        const layout = op.layoutRect()!;
        const typeName = readString(vm, op.typeName());
        const label = readString(vm, op.label()) ?? typeName ?? 'operator';
        const width = getPlanOperatorDisplayWidth(
            op.kind(),
            typeName,
            label,
            layout.width(),
            input.nodePaddingLeft,
            input.iconWidth,
            input.iconMarginRight,
            input.nodePaddingRight,
        );
        operators[i] = {
            id: i,
            kind: op.kind(),
            typeName,
            label,
            displayLabel: truncatePlanLabel(label, input.maxLabelChars),
            rect: { x: layout.x(), y: layout.y(), width, height: layout.height() },
            ports: 0,
            estimatedRows: op.estimatedRows(),
            properties: readAttributeRange(vm, op.attributesBegin(), op.attributeCount()),
        };
    }

    const edges: PlanSceneEdge[] = [];
    const tmpEdge = new dashql.buffers.view.PlanOperatorEdge();
    for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
        const edge = vm.operatorEdges(i, tmpEdge)!;
        const child = operators[edge.child()];
        const parent = operators[edge.parent()];
        child.ports |= PLAN_OPERATOR_PORT_OUTPUT;
        parent.ports |= PLAN_OPERATOR_PORT_INPUT;
        const edgeType = selectVerticalEdgeType(child.rect.x, child.rect.y, parent.rect.x, parent.rect.y);
        const path = buildEdgePathBetweenRectangles(
            new PathBuilder(), edgeType,
            child.rect.x, child.rect.y, parent.rect.x, parent.rect.y,
            child.rect.width, child.rect.height, parent.rect.width, parent.rect.height, 4,
        ).render();
        edges.push({
            id: i,
            childOperator: child.id,
            parentOperator: parent.id,
            slot: edge.slot(),
            outputCardinalityEstimated: Number.isNaN(child.estimatedRows) ? 0 : child.estimatedRows,
            path,
        });
    }

    const crossEdges: PlanSceneCrossEdge[] = [];
    const tmpCrossEdge = new dashql.buffers.view.PlanOperatorCrossEdge();
    for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
        const edge = vm.operatorCrossEdges(i, tmpCrossEdge)!;
        const source = operators[edge.source()];
        const target = operators[edge.target()];
        if (source == null || target == null) continue;
        source.ports |= PLAN_OPERATOR_PORT_OUTPUT;
        target.ports |= PLAN_OPERATOR_PORT_INPUT;
        const properties = readAttributeRange(vm, edge.attributesBegin(), edge.attributeCount());
        crossEdges.push({
            id: i,
            sourceOperator: source.id,
            targetOperator: target.id,
            kind: typeof properties.kind === 'string' ? properties.kind : 'reference',
            properties,
            path: buildCrossEdgePath(source.rect, target.rect),
        });
    }

    // A fragment owns the operators that are not in a nested fragment, its contour encloses the nested ones too.
    // Parents come before their children.
    const fragmentCount = vm.fragmentsLength();
    const tmpFragment = new dashql.buffers.view.PlanFragment();
    const enclosed: number[][] = [];
    const parents: number[] = [];
    const hidden: boolean[] = [];
    for (let i = 0; i < fragmentCount; ++i) {
        const fragment = vm.fragments(i, tmpFragment)!;
        enclosed.push(readIndexRange(j => vm.fragmentOperators(j), fragment.operatorsBegin(), fragment.operatorCount()));
        parents.push(fragment.parentFragment());
        hidden.push(fragment.hidden() !== 0);
    }
    for (let i = fragmentCount - 1; i >= 0; --i) {
        const parent = parents[i];
        if (parent !== U32_MAX && parent < i) enclosed[parent].push(...enclosed[i]);
    }
    const fragments: PlanSceneFragment[] = [];
    for (let i = 0; i < fragmentCount; ++i) {
        if (hidden[i]) continue;
        fragments.push({
            id: i,
            operatorIds: enclosed[i],
            path: buildFragmentPath(enclosed[i], operators, edges),
        });
    }

    const pipelines: PlanScenePipeline[] = [];
    const tmpPipeline = new dashql.buffers.view.PlanPipeline();
    const tmpSlot = new dashql.buffers.view.PlanSlot();
    for (let i = 0; i < vm.pipelinesLength(); ++i) {
        const pipeline = vm.pipelines(i, tmpPipeline)!;
        const operatorIds = readIndexRange(j => vm.slots(j, tmpSlot)?.operator() ?? null, pipeline.slotsBegin(), pipeline.slotCount());
        pipelines.push({
            id: i,
            operatorIds,
            path: buildPipelinePath(operatorIds, operators),
        });
    }

    const bounds = vm.layoutRect();
    return {
        width: bounds?.width() ?? 0,
        height: bounds?.height() ?? 0,
        layoutConfig,
        operators,
        edges,
        crossEdges,
        fragments,
        pipelines,
    };
}
