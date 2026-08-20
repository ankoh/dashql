import * as React from 'react';
import { GraphIcon, RowsIcon, ScreenFullIcon, ZoomInIcon, ZoomOutIcon } from '@primer/octicons-react';
import { select, zoom, zoomIdentity, ZoomBehavior, ZoomTransform } from 'd3';

import * as dashql from '../../../../../core/index.js';
import { JsonView } from '../../../../../ui/json/json_view.js';
import { IconButton, ButtonSize, ButtonVariant } from '../../../../../ui/foundations/button.js';
import { ButtonGroup } from '../../../../../ui/foundations/button_group.js';
import { AnchoredOverlay } from '../../../../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../../../../ui/foundations/anchored_position.js';
import { OverlaySize } from '../../../../../ui/foundations/overlay.js';
import { SymbolIcon } from '../../../../../ui/foundations/symbol_icon.js';
import { PlanExecutionController } from './plan_execution_controller.js';
import { getPlanOperatorSymbol, PLAN_OPERATOR_SYMBOL_SIZE, shouldRenderPlanOperatorSymbol } from './plan_operator_symbol.js';
import { materializePlanScene, PlanRowMetric, PlanScene, PlanSceneOperator, scaleRowWidths, selectDefaultRowMetric } from './plan_scene.js';
import * as styles from './plan_view.module.css';

const FIT_PADDING = 24;
const STATUS_PATHS: Record<number, string> = {
    [dashql.buffers.view.PlanExecutionStatus.UNKNOWN]: 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    [dashql.buffers.view.PlanExecutionStatus.PENDING]: 'M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    [dashql.buffers.view.PlanExecutionStatus.RUNNING]: 'M8 1a7 7 0 1 0 7 7h-2a5 5 0 1 1-5-5V1Z',
    [dashql.buffers.view.PlanExecutionStatus.SUCCEEDED]: 'M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z',
    [dashql.buffers.view.PlanExecutionStatus.FAILED]: 'M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 1 0-1.06-1.06L8 6.94 6.03 4.97Z',
    [dashql.buffers.view.PlanExecutionStatus.SKIPPED]: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm11.333-2.167a.825.825 0 0 0-1.166-1.166l-5.5 5.5a.825.825 0 0 0 1.166 1.166Z',
};

export function createPlanLayoutConfig(showProgress: boolean): dashql.buffers.view.PlanLayoutConfigT {
    const config = new dashql.buffers.view.PlanLayoutConfigT();
    config.levelHeight = 64;
    config.nodeHeight = 32;
    config.nodeMarginHorizontal = 32;
    config.nodePaddingLeft = 12;
    config.nodePaddingRight = 12;
    config.iconWidth = showProgress ? 14 : 0;
    config.iconMarginRight = showProgress ? 8 : 0;
    config.maxLabelChars = 20;
    config.widthPerLabelChar = 8.5;
    config.nodeMinWidth = 0;
    return config;
}

export interface PlanViewProps {
    plan: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>;
    showProgress?: boolean;
    controllerRef?: React.RefObject<PlanExecutionController | null>;
}

export function PlanView({ plan, showProgress = false, controllerRef }: PlanViewProps) {
    const scene = React.useMemo(() => materializePlanScene(plan), [plan]);
    const ownController = React.useRef<PlanExecutionController | null>(null);
    ownController.current ??= new PlanExecutionController();
    const controller = controllerRef?.current ?? ownController.current;
    const viewportRef = React.useRef<HTMLDivElement | null>(null);
    const svgRef = React.useRef<SVGSVGElement | null>(null);
    const sceneRef = React.useRef<SVGGElement | null>(null);
    const zoomRef = React.useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
    const transformRef = React.useRef<ZoomTransform>(zoomIdentity);
    const [selection, setSelection] = React.useState<{ operator: PlanSceneOperator; anchor: SVGGElement } | null>(null);
    const defaultMetric = React.useMemo(() => selectDefaultRowMetric(scene.edges), [scene.edges]);
    const [metricSelection, setMetricSelection] = React.useState<{ scene: PlanScene; metric: PlanRowMetric } | null>(null);
    const metric = metricSelection?.scene === scene ? metricSelection.metric : defaultMetric;
    const [positionRevision, setPositionRevision] = React.useState(0);
    const hasOutputRows = React.useMemo(() => scene.edges.some(edge => edge.outputCardinalityProduced != null), [scene.edges]);
    const edgeWidths = React.useMemo(
        () => scaleRowWidths(scene.edges.map(edge => metric === 'outputRows'
            ? edge.outputCardinalityProduced
            : edge.outputCardinalityEstimated)),
        [metric, scene.edges],
    );

    React.useLayoutEffect(() => {
        controller.reset(scene.operators.length, scene.pipelines.length);
        if (controllerRef != null) controllerRef.current = controller;
        return () => {
            if (controllerRef != null) controllerRef.current = null;
        };
    }, [controller, controllerRef, scene]);

    const fit = React.useCallback((animate = false) => {
        const viewport = viewportRef.current;
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (viewport == null || svg == null || behavior == null || scene.width <= 0 || scene.height <= 0) return;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;
        const scale = Math.min(1, (width - FIT_PADDING * 2) / scene.width, (height - FIT_PADDING * 2) / scene.height);
        const x = (width - scene.width * scale) / 2;
        const y = (height - scene.height * scale) / 2;
        const target = zoomIdentity.translate(x, y).scale(scale);
        const targetSelection = animate ? select(svg).transition().duration(160) : select(svg);
        targetSelection.call(behavior.transform as any, target);
    }, [scene.height, scene.width]);

    React.useLayoutEffect(() => {
        const svg = svgRef.current;
        const viewport = viewportRef.current;
        if (svg == null || viewport == null) return;
        const behavior = zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .clickDistance(4)
            .filter(event => !event.button && !(event.target instanceof Element && event.target.closest('button')))
            .on('zoom', event => {
                transformRef.current = event.transform;
                sceneRef.current?.setAttribute('transform', event.transform.toString());
                setPositionRevision(value => value + 1);
            });
        zoomRef.current = behavior;
        select(svg).call(behavior).on('dblclick.zoom', null);
        const observer = new ResizeObserver(() => fit());
        observer.observe(viewport);
        fit();
        return () => {
            observer.disconnect();
            select(svg).on('.zoom', null);
            zoomRef.current = null;
        };
    }, [fit]);

    const zoomBy = React.useCallback((factor: number) => {
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (svg != null && behavior != null) select(svg).transition().duration(120).call(behavior.scaleBy, factor);
    }, []);


    const onKeyDown = React.useCallback((event: React.KeyboardEvent) => {
        const svg = svgRef.current;
        const behavior = zoomRef.current;
        if (svg == null || behavior == null) return;
        const step = event.shiftKey ? 120 : 40;
        if (event.key === '+' || event.key === '=') zoomBy(1.25);
        else if (event.key === '-') zoomBy(0.8);
        else if (event.key === 'f') fit(true);
        else if (event.key === 'ArrowLeft') select(svg).call(behavior.translateBy, step, 0);
        else if (event.key === 'ArrowRight') select(svg).call(behavior.translateBy, -step, 0);
        else if (event.key === 'ArrowUp') select(svg).call(behavior.translateBy, 0, step);
        else if (event.key === 'ArrowDown') select(svg).call(behavior.translateBy, 0, -step);
        else return;
        event.preventDefault();
        event.stopPropagation();
    }, [fit, zoomBy]);

    const anchorRef = React.useMemo(() => ({ current: selection?.anchor ?? null }), [selection?.anchor]);
    return (
        <div
            ref={viewportRef}
            className={styles.viewport}
            role="region"
            aria-label={`Query execution plan with ${scene.operators.length} operators`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-tauri-drag-region="false"
        >
            <svg ref={svgRef} className={styles.svg} onClick={event => {
                if (event.target === svgRef.current) setSelection(null);
            }}>
                <g ref={sceneRef}>
                    <g>
                        {scene.fragments.map((fragment, fragmentIndex) => (
                            <g
                                key={fragment.id}
                                role="img"
                                aria-label={`Fragment ${fragment.id + 1}, containing operators: ${fragment.operatorIds
                                    .map(operatorId => scene.operators[operatorId]?.label)
                                    .filter((label): label is string => label != null)
                                    .join(', ')}`}
                            >
                                <path
                                    className={styles.fragment}
                                    d={fragment.path}
                                    data-color={fragmentIndex % 6}
                                />
                            </g>
                        ))}
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
                        {scene.edges.map((edge, edgeIndex) => (
                            <path
                                key={edge.id.toString()}
                                className={styles.edge}
                                d={edge.path}
                                style={{ strokeWidth: edgeWidths[edgeIndex] }}
                            />
                        ))}
                    </g>
                    <g>
                        {scene.operators.map(operator => (
                            <PlanOperatorNode
                                key={operator.id}
                                operator={operator}
                                scene={scene}
                                showProgress={showProgress}
                                selected={selection?.operator.id === operator.id}
                                controller={controller}
                                onSelect={(selected, anchor) => setSelection(current => current?.operator.id === selected.id ? null : { operator: selected, anchor })}
                            />
                        ))}
                    </g>
                </g>
            </svg>
            <ButtonGroup className={styles.metric_controls} aria-label="Plan metric controls">
                <IconButton
                    className={styles.metric_button}
                    variant={ButtonVariant.Default}
                    size={ButtonSize.Small}
                    aria-label="Encode estimated rows as edge thickness"
                    aria-pressed={metric === 'estimatedRows'}
                    onClick={() => setMetricSelection({ scene, metric: 'estimatedRows' })}
                >
                    <GraphIcon size={12} />
                </IconButton>
                <IconButton
                    className={styles.metric_button}
                    variant={ButtonVariant.Default}
                    size={ButtonSize.Small}
                    aria-label="Encode actual output rows as edge thickness"
                    aria-pressed={metric === 'outputRows'}
                    disabled={!hasOutputRows}
                    onClick={() => setMetricSelection({ scene, metric: 'outputRows' })}
                >
                    <RowsIcon size={12} />
                </IconButton>
            </ButtonGroup>
            <ButtonGroup className={styles.controls} aria-label="Plan zoom controls">
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom in" onClick={() => zoomBy(1.25)}><ZoomInIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Zoom out" onClick={() => zoomBy(0.8)}><ZoomOutIcon size={12} /></IconButton>
                <IconButton variant={ButtonVariant.Default} size={ButtonSize.Small} aria-label="Fit plan" onClick={() => fit(true)}><ScreenFullIcon size={12} /></IconButton>
            </ButtonGroup>
            <AnchoredOverlay
                renderAnchor={null}
                anchorRef={anchorRef}
                open={selection != null}
                onClose={() => setSelection(null)}
                side={AnchorSide.OutsideRight}
                align={AnchorAlignment.Center}
                anchorOffset={8}
                width={OverlaySize.L}
                maxHeight={OverlaySize.L}
                positionRevision={positionRevision}
            >
                <section className={styles.inspector} aria-label={`${selection?.operator.label ?? 'Operator'} properties`}>
                    <header className={styles.inspector_header}>
                        <strong>{selection?.operator.label}</strong>
                        <span>{selection?.operator.typeName}</span>
                    </header>
                    {selection != null && <JsonView value={selection.operator.properties} collapsed={2} shortenTextAfterLength={100} />}
                </section>
            </AnchoredOverlay>
        </div>
    );
}

function PlanOperatorNode(props: {
    operator: PlanSceneOperator;
    scene: PlanScene;
    showProgress: boolean;
    selected: boolean;
    controller: PlanExecutionController;
    onSelect: (operator: PlanSceneOperator, anchor: SVGGElement) => void;
}) {
    const { operator, scene } = props;
    const labelClipId = React.useId();
    const x = operator.rect.x - operator.rect.width / 2;
    const y = operator.rect.y - operator.rect.height / 2;
    const input = scene.layoutConfig.input!;
    const regionStart = input.nodePaddingLeft + input.iconWidth + input.iconMarginRight;
    const regionEnd = operator.rect.width - input.nodePaddingRight;
    const renderSymbol = shouldRenderPlanOperatorSymbol(operator.typeName, operator.label);
    const symbolName = renderSymbol ? getPlanOperatorSymbol(operator.typeName) : null;
    const OperatorSymbol = symbolName != null ? SymbolIcon(symbolName) : null;
    const activate = (event: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>) => {
        if ('key' in event && event.key !== 'Enter' && event.key !== ' ') return;
        if ('key' in event) event.preventDefault();
        event.stopPropagation();
        props.onSelect(operator, event.currentTarget);
    };
    return (
        <g
            className={styles.operator}
            data-selected={props.selected}
            transform={`translate(${x}, ${y})`}
            role="button"
            tabIndex={0}
            aria-label={`${operator.label}, show properties`}
            aria-expanded={props.selected}
            onClick={activate}
            onKeyDown={activate}
        >
            <rect width={operator.rect.width} height={operator.rect.height} rx={6} ry={6} />
            <clipPath id={labelClipId}>
                <path d={`M ${regionStart} 0 H ${regionEnd} V ${input.nodeHeight} H ${regionStart} Z`} />
            </clipPath>
            {props.showProgress && (
                <g
                    ref={slot => props.controller.registerOperator(operator.id, slot)}
                    className={styles.status}
                    transform={`translate(${input.nodePaddingLeft}, ${(input.nodeHeight - input.iconWidth) / 2})`}
                    aria-hidden="true"
                >
                    {Object.entries(STATUS_PATHS).map(([status, path]) => <path key={status} data-status-icon={status} d={path} transform={`scale(${input.iconWidth / 16})`} />)}
                </g>
            )}
            {OperatorSymbol != null
                ? <g className={styles.operator_symbol} transform={`translate(${(regionStart + regionEnd - PLAN_OPERATOR_SYMBOL_SIZE) / 2}, ${(input.nodeHeight - PLAN_OPERATOR_SYMBOL_SIZE) / 2})`} aria-hidden="true"><OperatorSymbol size={PLAN_OPERATOR_SYMBOL_SIZE} /></g>
                : <text clipPath={`url(#${labelClipId})`} x={(regionStart + regionEnd) / 2} y={input.nodeHeight / 2 + 5}>{operator.displayLabel}</text>}
        </g>
    );
}
