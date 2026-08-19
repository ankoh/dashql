import * as dashql from '../../../../../core/index.js';
import { U32_MAX } from '../../../../../utils/numeric_limits.js';
import { buildEdgePathBetweenRectangles, PathBuilder, selectVerticalEdgeType } from '../../../../../utils/graph_edges.js';
import { getPlanOperatorDisplayWidth } from './plan_operator_symbol.js';

export interface PlanSceneRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PlanSceneOperator {
    id: number;
    typeName: string | null;
    label: string;
    displayLabel: string;
    rect: PlanSceneRect;
    statistics: PlanSceneOperatorStatistics;
    properties: Record<string, unknown>;
}

export interface PlanSceneOperatorStatistics {
    inputCardinalityEstimated: number;
    inputCardinalityConsumed: bigint;
    outputCardinalityEstimated: number;
    outputCardinalityProduced: bigint;
    hasOutputCardinalityProduced: boolean;
    memoryBytes: bigint;
}

export type PlanRowMetric = 'estimatedRows' | 'outputRows';

export interface PlanSceneEdge {
    id: bigint;
    childOperator: number;
    parentOperator: number;
    outputCardinalityEstimated: number;
    outputCardinalityProduced: number | null;
    path: string;
}

export interface PlanScenePipeline {
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
    pipelines: readonly PlanScenePipeline[];
}

function readString(vm: dashql.buffers.view.PlanViewModel, id: number): string | null {
    return id !== U32_MAX ? vm.stringDictionary(id) : null;
}

function readProperties(vm: dashql.buffers.view.PlanViewModel, op: dashql.buffers.view.PlanOperator): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const attribute = new dashql.buffers.view.PlanAttribute();
    for (let i = 0; i < op.attributeCount(); ++i) {
        const value = vm.attributes(op.attributesBegin() + i, attribute);
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

function readNumberProperty(value: unknown, names: readonly string[]): number | null {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
    const properties = value as Record<string, unknown>;
    for (const name of names) {
        const metric = properties[name];
        if (typeof metric === 'number' && Number.isFinite(metric)) return metric;
    }
    return null;
}

export function hasOutputCardinalityProduced(properties: Record<string, unknown>): boolean {
    const statistics = properties.statistics;
    return readNumberProperty(statistics, ['output-rows', 'outputRows']) != null
        || readNumberProperty(properties, ['output-rows', 'outputRows']) != null;
}

export function selectDefaultRowMetric(edges: readonly Pick<PlanSceneEdge, 'outputCardinalityProduced'>[]): PlanRowMetric {
    return edges.some(edge => edge.outputCardinalityProduced != null) ? 'outputRows' : 'estimatedRows';
}

export function scaleRowWidths(values: readonly (number | null)[], minWidth = 1, maxWidth = 8): number[] {
    const finiteValues = values.map(value => value != null && Number.isFinite(value) ? Math.max(0, value) : 0);
    let maxValue = 0;
    for (const value of finiteValues) maxValue = Math.max(maxValue, value);
    if (maxValue === 0 || maxWidth <= minWidth) return finiteValues.map(() => minWidth);
    const denominator = Math.log1p(maxValue);
    return finiteValues.map(value => minWidth + Math.log1p(value) / denominator * (maxWidth - minWidth));
}

export function truncatePlanLabel(label: string, maxChars: number): string {
    const chars = Array.from(label);
    if (chars.length <= maxChars) return label;
    if (maxChars === 0) return '';
    return `${chars.slice(0, maxChars - 1).join('')}…`;
}

function buildPipelinePath(operatorIds: readonly number[], operators: readonly PlanSceneOperator[]): string {
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

export function materializePlanScene(viewModel: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>): PlanScene {
    const vm = viewModel.read();
    const layoutConfig = vm.layoutConfig()!.unpack();
    const operators: PlanSceneOperator[] = new Array(vm.operatorsLength());
    const tmpOperator = new dashql.buffers.view.PlanOperator();
    const tmpStatistics = new dashql.buffers.view.PlanExecutionStatistics();
    for (let i = 0; i < vm.operatorsLength(); ++i) {
        const op = vm.operators(i, tmpOperator)!;
        const layout = op.layoutRect()!;
        const statistics = op.executionStatistics(tmpStatistics)!;
        const typeName = readString(vm, op.operatorTypeName());
        const label = readString(vm, op.operatorLabel()) ?? typeName ?? 'operator';
        const properties = readProperties(vm, op);
        const hasProducedRows = hasOutputCardinalityProduced(properties);
        const input = layoutConfig.input!;
        const width = getPlanOperatorDisplayWidth(
            typeName,
            label,
            layout.width(),
            input.nodePaddingLeft,
            input.iconWidth,
            input.iconMarginRight,
            input.nodePaddingRight,
        );
        operators[op.operatorId()] = {
            id: op.operatorId(),
            typeName,
            label,
            displayLabel: truncatePlanLabel(label, layoutConfig.input!.maxLabelChars),
            rect: { x: layout.x(), y: layout.y(), width, height: layout.height() },
            statistics: {
                inputCardinalityEstimated: statistics.inputCardinalityEstimated(),
                inputCardinalityConsumed: statistics.inputCardinalityConsumed(),
                outputCardinalityEstimated: statistics.outputCardinalityEstimated(),
                outputCardinalityProduced: statistics.outputCardinalityProduced(),
                hasOutputCardinalityProduced: hasProducedRows,
                memoryBytes: statistics.memoryBytes(),
            },
            properties,
        };
    }

    const edges: PlanSceneEdge[] = [];
    const tmpEdge = new dashql.buffers.view.PlanOperatorEdge();
    for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
        const edge = vm.operatorEdges(i, tmpEdge)!;
        const child = operators[edge.childOperator()];
        const parent = operators[edge.parentOperator()];
        const edgeType = selectVerticalEdgeType(child.rect.x, child.rect.y, parent.rect.x, parent.rect.y);
        const path = buildEdgePathBetweenRectangles(
            new PathBuilder(), edgeType,
            child.rect.x, child.rect.y, parent.rect.x, parent.rect.y,
            child.rect.width, child.rect.height, parent.rect.width, parent.rect.height, 4,
        ).render();
        edges.push({
            id: edge.edgeId(),
            childOperator: child.id,
            parentOperator: parent.id,
            outputCardinalityEstimated: child.statistics.outputCardinalityEstimated,
            outputCardinalityProduced: child.statistics.hasOutputCardinalityProduced
                ? Number(child.statistics.outputCardinalityProduced)
                : null,
            path,
        });
    }

    const pipelines: PlanScenePipeline[] = [];
    const tmpPipeline = new dashql.buffers.view.PlanPipeline();
    for (let i = 0; i < vm.pipelinesLength(); ++i) {
        const pipeline = vm.pipelines(i, tmpPipeline)!;
        const operatorIds: number[] = [];
        for (let j = 0; j < pipeline.operatorCount(); ++j) {
            const operatorId = vm.pipelineOperators(pipeline.operatorsBegin() + j);
            if (operatorId != null) operatorIds.push(operatorId);
        }
        pipelines[pipeline.pipelineId()] = {
            id: pipeline.pipelineId(),
            operatorIds,
            path: buildPipelinePath(operatorIds, operators),
        };
    }

    const bounds = vm.layoutRect();
    return {
        width: bounds?.width() ?? 0,
        height: bounds?.height() ?? 0,
        layoutConfig,
        operators,
        edges,
        pipelines,
    };
}
