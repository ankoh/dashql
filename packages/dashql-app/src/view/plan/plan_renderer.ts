import * as dashql from '@ankoh/dashql-core';
import * as styles from './plan_renderer.module.css';
import { U32_MAX } from '../../utils/numeric_limits.js';
import { buildEdgePathBetweenRectangles, EdgePathBuilder, selectVerticalEdgeType } from '../../utils/graph_edges.js';
import { PlanRenderingSymbols } from './plan_renderer_symbols.js';
import { IndicatorStatus } from '../../view/foundations/status_indicator.js';

const SVG_NS = "http://www.w3.org/2000/svg";

/// This file contains a plan renderer.
/// The plan renderer is deliberately implemented using raw DOM updates.
/// The goal is to potentially stream hundreds of plan progress events and visualize them instantly.
///
/// This does not really work if we run with full react view consolidation across all plan nodes and edges.
/// We'd re-evaluate far too much from the virtual dom over and over again.
/// Users usually display the full plan so we can just render everything once and then prioritize being very fast with updates.

export interface PlanRenderingState {
    /// The layout config
    layoutConfig: dashql.buffers.view.DerivedPlanLayoutConfigT;
    /// The root ndoe
    rootNode: HTMLDivElement;
    /// The root center node
    rootContainer: SVGElement;
    /// The symbols
    symbols: PlanRenderingSymbols;
    /// The operator layer
    operatorLayer: SVGGElement;
    /// The operator edge layer
    operatorEdgeLayer: SVGGElement;
    /// The edge path builder
    edgePathBuilder: EdgePathBuilder;
}

export class PlanRenderer {
    /// The plan stages
    protected fragments: PlanFragmentRenderer[] = [];
    /// The plan pipelines
    protected pipelines: PlanPipelineRenderer[] = [];
    /// The plan nodes
    protected operators: PlanOperatorRenderer[] = [];
    /// The regular edge renderers
    protected operatorEdges: Map<bigint, PlanOperatorEdgeRenderer> = new Map();
    /// The cross edge renderer
    protected operatorCrossEdges: Map<bigint, PlanOperatorCrossEdgeRenderer> = new Map();

    /// The div where we add the root node as child
    protected mountPoint: HTMLDivElement | null = null;
    /// The current renderer output (if rendered)
    protected rendered: PlanRenderingState | null = null;

    /// Constructor
    constructor() { }
    /// Reset the renderer
    public reset() {
        this.operators = [];
        this.fragments = [];
        this.pipelines = [];
        this.operatorEdges = new Map();
        this.operatorCrossEdges = new Map();
    }
    /// Mount the renderer to a node
    public mountTo(root: HTMLDivElement) {
        const prev = this.mountPoint;
        this.mountPoint = root;

        // Mount if the mount point changed and we rendered the root
        if (this.mountPoint != prev && this.mountPoint != null && this.rendered != null) {
            this.mountPoint.appendChild(this.rendered.rootNode);
        }
    }

    /// Render the plan
    public render(viewModel: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>) {
        const vm = viewModel.read();
        const layoutConfig = vm.layoutConfig()!.unpack();

        for (let i = 0; i < vm.fragmentsLength(); ++i) {
            this.fragments.push(new PlanFragmentRenderer());
        }
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            this.operators.push(new PlanOperatorRenderer());
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            this.pipelines.push(new PlanPipelineRenderer());
        }

        const tmpPipeline = new dashql.buffers.view.PlanPipeline();
        const tmpPipelineEdge = new dashql.buffers.view.PlanPipelineEdge();
        const tmpFragment = new dashql.buffers.view.PlanFragment();
        const tmpOperator = new dashql.buffers.view.PlanOperator();
        const tmpEdge = new dashql.buffers.view.PlanOperatorEdge();
        const tmpCrossEdge = new dashql.buffers.view.PlanOperatorCrossEdge();

        for (let i = 0; i < vm.fragmentsLength(); ++i) {
            const stage = vm.fragments(i, tmpFragment)!;
            this.fragments[stage.fragmentId()].prepare(layoutConfig, vm, stage);
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(layoutConfig, vm, pipelineVM);
            this.fragments[pipelineVM.fragmentId()].registerPipeline(pipeline);
        }
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            const opVM = vm.operators(i, tmpOperator)!;
            const node = this.operators[opVM.operatorId()];
            node.prepare(layoutConfig, vm, opVM);
            this.fragments[opVM.fragmentId()].registerOperator(node);
        }
        for (let i = 0; i < vm.pipelineEdgesLength(); ++i) {
            const edgeVM = vm.pipelineEdges(i, tmpPipelineEdge)!;
            const op = this.operators[edgeVM.parentOperator()];
            this.pipelines[edgeVM.pipelineId()].registerOperator(op, edgeVM.parentBreaksPipeline() != 0);
        }
        for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
            const edgeVM = vm.operatorEdges(i, tmpEdge)!;
            const parentNode = this.operators[edgeVM.parentOperator()];
            const childNode = this.operators[edgeVM.childOperator()];
            const edgeRenderer = new PlanOperatorEdgeRenderer();
            edgeRenderer.prepare(layoutConfig, vm, edgeVM, parentNode, childNode);
            this.operatorEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
            const edgeVM = vm.operatorCrossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorCrossEdgeRenderer();
            edgeRenderer.prepare(layoutConfig, vm, edgeVM, sourceNode, targetNode);
            this.operatorCrossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }

        if (this.rendered == null) {
            const rootNode = document.createElement("div");
            const rootSvgContainer = document.createElementNS(SVG_NS, 'svg');
            const operatorLayer = document.createElementNS(SVG_NS, 'g');
            const operatorEdgeLayer = document.createElementNS(SVG_NS, 'g');
            const edgePathBuilder = new EdgePathBuilder();

            rootNode.className = styles.root;
            rootSvgContainer.classList.add(styles.root_inner_container);

            rootNode.appendChild(rootSvgContainer);
            rootSvgContainer.appendChild(operatorLayer);
            rootSvgContainer.appendChild(operatorEdgeLayer);

            const symbols = new PlanRenderingSymbols(rootSvgContainer, layoutConfig);
            this.rendered = {
                layoutConfig,
                rootNode,
                rootContainer: rootSvgContainer,
                symbols,
                operatorLayer,
                operatorEdgeLayer,
                edgePathBuilder,
            };
        } else {
            this.rendered.operatorLayer.replaceChildren();
            this.rendered.operatorEdgeLayer.replaceChildren();
        }
        this.rendered.rootContainer.setAttribute("width", `${vm.layoutRect()!.width()}px`);
        this.rendered.rootContainer.setAttribute("height", `${vm.layoutRect()!.height()}px`);

        // Invoke the renderers
        for (const stage of this.fragments) {
            stage.render(this.rendered);
        }
        for (const pipeline of this.pipelines) {
            pipeline.render(this.rendered);
        }
        for (const op of this.operators) {
            op.render(this.rendered);
        }
        for (const [_, edge] of this.operatorEdges) {
            edge.render(this.rendered);
        }
        for (const [_, crossEdge] of this.operatorCrossEdges) {
            crossEdge.render(this.rendered);
        }

        if (this.mountPoint != null) {
            this.mountPoint.appendChild(this.rendered.rootNode);
        }
    }

    /// Update the plan viewer with a set of change events
    public applyChangeEvents(eventsPtr: dashql.FlatBufferPtr<dashql.buffers.view.PlanChangeEvents>) {
        const eventsReader = eventsPtr.read();

        const tmpUpdateFragmentStats = new dashql.buffers.view.UpdateFragmentUpdateEvent();
        const tmpUpdatePipelineStats = new dashql.buffers.view.UpdatePipelineUpdateEvent();
        const tmpUpdateNodeStats = new dashql.buffers.view.UpdateOperatorUpdateEvent();
        const tmpUpdateEdgeStats = new dashql.buffers.view.UpdateOperatorEdgeUpdateEvent();
        const tmpUpdateCrossEdgeStats = new dashql.buffers.view.UpdateOperatorCrossEdgeUpdateEvent();

        // Apply the change events
        for (let i = 0; i < eventsReader.eventsLength(); ++i) {
            switch (eventsReader.eventsType(i)) {
                case dashql.buffers.view.PlanChangeEvent.UpdateFragmentUpdateEvent: {
                    const s = eventsReader.events(i, tmpUpdateFragmentStats)! as dashql.buffers.view.UpdateFragmentUpdateEvent;
                    this.fragments[s.fragmentId()].update(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdatePipelineUpdateEvent: {
                    const s = eventsReader.events(i, tmpUpdatePipelineStats)! as dashql.buffers.view.UpdatePipelineUpdateEvent;
                    this.pipelines[s.pipelineId()].update(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorUpdateEvent: {
                    const s = eventsReader.events(i, tmpUpdateNodeStats)! as dashql.buffers.view.UpdateOperatorUpdateEvent;
                    this.operators[s.operatorId()].update(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorEdgeUpdateEvent: {
                    const s = eventsReader.events(i, tmpUpdateEdgeStats)! as dashql.buffers.view.UpdateOperatorEdgeUpdateEvent;
                    this.operatorEdges.get(s.operatorEdgeId())!.update(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorCrossEdgeUpdateEvent: {
                    const s = eventsReader.events(i, tmpUpdateCrossEdgeStats)! as dashql.buffers.view.UpdateOperatorCrossEdgeUpdateEvent;
                    this.operatorCrossEdges.get(s.operatorCrossEdgeId())!.update(s);
                    break;
                }
            }
        }
    }
}

function readString(vm: dashql.buffers.view.PlanViewModel, id: number): string | null {
    return id != U32_MAX ? vm.stringDictionary(id) : null;
}

export class PlanOperatorRenderer {
    operatorNode: SVGGElement | null;
    operatorIcon: SVGUseElement | null;
    operatorRect: SVGRectElement | null;
    operatorTypeName: string | null;
    operatorLabel: string | null;
    labelNode: SVGTextElement | null;
    layoutRect: dashql.buffers.view.PlanLayoutRectT;

    constructor() {
        this.operatorNode = null;
        this.operatorIcon = null;
        this.operatorRect = null;
        this.operatorTypeName = null;
        this.operatorLabel = null;
        this.labelNode = null;
        this.layoutRect = new dashql.buffers.view.PlanLayoutRectT();
    }

    public getLayoutRect() { return this.layoutRect; }

    public prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, vm: dashql.buffers.view.PlanViewModel, op: dashql.buffers.view.PlanOperator) {
        this.operatorTypeName = readString(vm, op.operatorTypeName());
        this.operatorLabel = readString(vm, op.operatorLabel()) ?? this.operatorTypeName;
        const layout = op.layoutRect();
        if (layout != null) {
            op.layoutRect()!.unpackTo(this.layoutRect);
        }
    }

    public render(state: PlanRenderingState) {
        this.operatorNode = document.createElementNS(SVG_NS, "g");
        const nodeX = this.layoutRect.x - this.layoutRect.width / 2;
        const nodeY = this.layoutRect.y - this.layoutRect.height / 2;
        this.operatorNode.setAttribute("transform", `translate(${nodeX}, ${nodeY})`);

        this.operatorRect = document.createElementNS(SVG_NS, "rect");
        this.operatorRect.setAttribute("height", `${this.layoutRect.height}`);
        this.operatorRect.setAttribute("width", `${this.layoutRect.width}`);
        this.operatorRect.setAttribute("rx", "4");
        this.operatorRect.setAttribute("ry", "4");
        this.operatorRect.setAttribute("fill", "transparent");
        this.operatorRect.setAttribute("stroke", "black");
        this.operatorNode.appendChild(this.operatorRect);

        const iconX = state.layoutConfig.input!.nodePaddingLeft;
        const iconY = state.layoutConfig.input!.nodeHeight / 2 - state.layoutConfig.input!.iconWidth / 2;
        const icon = state.symbols.getStatusIcon(iconX, iconY, state.layoutConfig.input!.iconWidth, state.layoutConfig.input!.iconWidth, IndicatorStatus.None);
        this.operatorNode.appendChild(icon);

        this.labelNode = document.createElementNS(SVG_NS, "text");
        this.labelNode.setAttribute("dominant-baseline", "auto");
        this.labelNode.setAttribute("text-anchor", "left");
        this.labelNode.setAttribute("font-family", "Roboto Mono");
        this.labelNode.setAttribute("font-size", "0.85rem");
        const textX = state.layoutConfig.input!.nodePaddingLeft + state.layoutConfig.input!.iconWidth + state.layoutConfig.input!.iconMarginRight;
        const textY = state.layoutConfig.input!.nodeHeight / 2 + 5;
        this.labelNode.setAttribute("x", textX.toString());
        this.labelNode.setAttribute("y", textY.toString());
        this.labelNode.textContent = this.operatorLabel;
        this.operatorNode.appendChild(this.labelNode);

        state.operatorLayer.appendChild(this.operatorNode);
    }

    public update(_event: dashql.buffers.view.UpdateOperatorUpdateEvent) { }
}

export class PlanFragmentRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _stage: dashql.buffers.view.PlanFragment) { };
    registerOperator(_node: PlanOperatorRenderer) { }
    registerPipeline(_node: PlanPipelineRenderer) { }
    render(_state: PlanRenderingState) { }

    update(_event: dashql.buffers.view.UpdateFragmentUpdateEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _p: dashql.buffers.view.PlanPipeline) { };
    registerOperator(_op: PlanOperatorRenderer, _breaksPipeline: boolean) { }
    render(_state: PlanRenderingState) { }

    update(_event: dashql.buffers.view.UpdatePipelineUpdateEvent) { }
}

export class PlanOperatorEdgeRenderer {
    parent: PlanOperatorRenderer | null;
    child: PlanOperatorRenderer | null;
    path: SVGPathElement | null;
    parentPortCount: number;
    parentPortIndex: number;

    constructor() {
        this.parent = null;
        this.child = null;
        this.path = null;
        this.parentPortCount = 0;
        this.parentPortIndex = 0;
    }

    public prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, edge: dashql.buffers.view.PlanOperatorEdge, parent: PlanOperatorRenderer, child: PlanOperatorRenderer) {
        this.parent = parent;
        this.child = child;
        this.parentPortCount = Math.max(edge.parentOperatorPortCount(), 1);
        this.parentPortIndex = edge.parentOperatorPortIndex();
    }
    public render(state: PlanRenderingState) {
        const parentRect = this.parent!.getLayoutRect();
        // const totalPortsWidth = parentRect.width - state.layoutConfig.input!.paddingLeft - state.layoutConfig.input!.paddingRight;
        // const portWidth = totalPortsWidth / (this.parentPortCount + 1);
        // const portStart = parentRect.x - parentRect.width / 2 + state.layoutConfig.input!.paddingLeft;
        const parentY = parentRect.y;
        // const parentX = portStart + (this.parentPortIndex + 1) * portWidth;
        const parentX = parentRect.x;

        const childRect = this.child!.getLayoutRect();
        const childY = childRect.y;
        const childX = childRect.x;

        const edgeType = selectVerticalEdgeType(childX, childY, parentX, parentY);
        const edgePath = buildEdgePathBetweenRectangles(state.edgePathBuilder, edgeType, childX, childY, parentX, parentY, childRect.width, childRect.height, parentRect.width, parentRect.height, 4);
        console.log({
            parentX,
            parentY,
            childX,
            childY,
            edgePath
        });
        this.path = document.createElementNS(SVG_NS, 'path');
        this.path.setAttribute("d", edgePath);
        this.path.setAttribute("stroke-width", "1px");
        this.path.setAttribute("stroke", "black");
        this.path.setAttribute("fill", "transparent");
        this.path.setAttribute("pointer-events", "stroke");
        state.operatorEdgeLayer.appendChild(this.path);
    }

    public update(_event: dashql.buffers.view.UpdateOperatorEdgeUpdateEvent) { }
}

export class PlanOperatorCrossEdgeRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _cross: dashql.buffers.view.PlanOperatorCrossEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }
    render(_state: PlanRenderingState) { }

    update(_event: dashql.buffers.view.UpdateOperatorCrossEdgeUpdateEvent) { }
}
