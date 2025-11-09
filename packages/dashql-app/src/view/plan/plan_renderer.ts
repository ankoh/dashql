import * as dashql from '@ankoh/dashql-core';
import * as styles from './plan_renderer.module.css';
import { U32_MAX } from '../../utils/numeric_limits.js';
import { buildEdgePathBetweenRectangles, EdgePathBuilder, selectVerticalEdgeType } from '../../utils/graph_edges.js';
import { PlanRenderingSymbols } from './plan_renderer_symbols.js';

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
    state: PlanRenderingState | null = null;

    /// Constructor
    constructor() { }
    /// Reset the renderer
    public reset() {
        this.operators = [];
        this.fragments = [];
        this.pipelines = [];
        this.operatorEdges = new Map();
        this.operatorCrossEdges = new Map();

        if (this.state != null) {
            this.state.rootNode.replaceChildren();
            this.state = null;
        }
    }
    /// Mount the renderer to a node
    public mountTo(root: HTMLDivElement) {
        const prev = this.mountPoint;
        this.mountPoint = root;

        // Mount if the mount point changed and we rendered the root
        if (this.mountPoint != prev && this.mountPoint != null && this.state != null) {
            this.mountPoint.appendChild(this.state.rootNode);
        }
    }

    /// Render the plan
    public render(viewModel: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>) {
        this.reset();

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
            this.fragments[stage.fragmentId()].prepare(this, vm, stage);
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(this, vm, pipelineVM);
            this.fragments[pipelineVM.fragmentId()].registerPipeline(this, pipeline);
        }
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            const opVM = vm.operators(i, tmpOperator)!;
            const node = this.operators[opVM.operatorId()];
            node.prepare(this, vm, opVM);
            this.fragments[opVM.fragmentId()].registerOperator(this, node);
        }
        for (let i = 0; i < vm.pipelineEdgesLength(); ++i) {
            const edgeVM = vm.pipelineEdges(i, tmpPipelineEdge)!;
            const op = this.operators[edgeVM.parentOperator()];
            this.pipelines[edgeVM.pipelineId()].registerOperator(this, op, edgeVM.parentBreaksPipeline() != 0);
        }
        for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
            const edgeVM = vm.operatorEdges(i, tmpEdge)!;
            const parentNode = this.operators[edgeVM.parentOperator()];
            const childNode = this.operators[edgeVM.childOperator()];
            const edgeRenderer = new PlanOperatorEdgeRenderer();
            edgeRenderer.prepare(this, vm, edgeVM, parentNode, childNode);
            this.operatorEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
            const edgeVM = vm.operatorCrossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorCrossEdgeRenderer();
            edgeRenderer.prepare(this, vm, edgeVM, sourceNode, targetNode);
            this.operatorCrossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }

        if (this.state == null) {
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
            this.state = {
                layoutConfig,
                rootNode,
                rootContainer: rootSvgContainer,
                symbols,
                operatorLayer,
                operatorEdgeLayer,
                edgePathBuilder,
            };
        } else {
            this.state.operatorLayer.replaceChildren();
            this.state.operatorEdgeLayer.replaceChildren();
        }
        this.state!.rootContainer.setAttribute("width", `${vm.layoutRect()!.width()}px`);
        this.state!.rootContainer.setAttribute("height", `${vm.layoutRect()!.height()}px`);

        // Invoke the renderers
        for (const stage of this.fragments) {
            stage.render(this);
        }
        for (const pipeline of this.pipelines) {
            pipeline.render(this);
        }
        for (const op of this.operators) {
            op.render(this);
        }
        for (const [_, edge] of this.operatorEdges) {
            edge.render(this);
        }
        for (const [_, crossEdge] of this.operatorCrossEdges) {
            crossEdge.render(this);
        }

        if (this.mountPoint != null) {
            this.mountPoint.appendChild(this.state.rootNode);
        }
    }

    /// Update the plan viewer with a set of change events
    public applyChangeEvents(events: dashql.buffers.view.PlanChangeEvents) {
        const tmpUpdateFragmentStats = new dashql.buffers.view.UpdateFragmentEvent();
        const tmpUpdatePipelineStats = new dashql.buffers.view.UpdatePipelineEvent();
        const tmpUpdateNodeStats = new dashql.buffers.view.UpdateOperatorEvent();
        const tmpUpdateEdgeStats = new dashql.buffers.view.UpdateOperatorEdgeEvent();
        const tmpUpdateCrossEdgeStats = new dashql.buffers.view.UpdateOperatorCrossEdgeEvent();

        // Apply the change events
        for (let i = 0; i < events.eventsLength(); ++i) {
            switch (events.eventsType(i)) {
                case dashql.buffers.view.PlanChangeEvent.UpdateFragmentEvent: {
                    const s = events.events(i, tmpUpdateFragmentStats)! as dashql.buffers.view.UpdateFragmentEvent;
                    this.fragments[s.fragmentId()].update(this, s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdatePipelineEvent: {
                    const s = events.events(i, tmpUpdatePipelineStats)! as dashql.buffers.view.UpdatePipelineEvent;
                    this.pipelines[s.pipelineId()].update(this, s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorEvent: {
                    const s = events.events(i, tmpUpdateNodeStats)! as dashql.buffers.view.UpdateOperatorEvent;
                    this.operators[s.operatorId()].update(this, s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorEdgeEvent: {
                    const s = events.events(i, tmpUpdateEdgeStats)! as dashql.buffers.view.UpdateOperatorEdgeEvent;
                    this.operatorEdges.get(s.operatorEdgeId())!.update(this, s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorCrossEdgeEvent: {
                    const s = events.events(i, tmpUpdateCrossEdgeStats)! as dashql.buffers.view.UpdateOperatorCrossEdgeEvent;
                    this.operatorCrossEdges.get(s.operatorCrossEdgeId())!.update(this, s);
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
    operatorIcon: SVGElement | null;
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

    public prepare(_renderer: PlanRenderer, vm: dashql.buffers.view.PlanViewModel, op: dashql.buffers.view.PlanOperator) {
        this.operatorTypeName = readString(vm, op.operatorTypeName());
        this.operatorLabel = readString(vm, op.operatorLabel()) ?? this.operatorTypeName;
        const layout = op.layoutRect();
        if (layout != null) {
            op.layoutRect()!.unpackTo(this.layoutRect);
        }
    }

    public render(renderer: PlanRenderer) {
        const state = renderer.state;
        if (state == null) {
            return;
        }

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
        this.operatorIcon = state.symbols.getStatusIcon(iconX, iconY, state.layoutConfig.input!.iconWidth, state.layoutConfig.input!.iconWidth, dashql.buffers.view.PlanExecutionStatus.UNKNOWN);
        this.operatorNode.appendChild(this.operatorIcon);

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

    public update(renderer: PlanRenderer, event: dashql.buffers.view.UpdateOperatorEvent) {
        const state = renderer.state;
        if (state == null || this.operatorIcon == null) {
            return;
        }
        const iconX = state.layoutConfig.input!.nodePaddingLeft;
        const iconY = state.layoutConfig.input!.nodeHeight / 2 - state.layoutConfig.input!.iconWidth / 2;
        const newChild = state.symbols.getStatusIcon(iconX, iconY, state.layoutConfig.input!.iconWidth, state.layoutConfig.input!.iconWidth, event.executionStatus());
        this.operatorNode!.replaceChild(newChild, this.operatorIcon!);
        this.operatorIcon = newChild;
    }
}

export class PlanFragmentRenderer {
    constructor() { }

    prepare(_renderer: PlanRenderer, _vm: dashql.buffers.view.PlanViewModel, _stage: dashql.buffers.view.PlanFragment) { };
    registerOperator(_renderer: PlanRenderer, _node: PlanOperatorRenderer) { }
    registerPipeline(_renderer: PlanRenderer, _node: PlanPipelineRenderer) { }
    render(_renderer: PlanRenderer) { }

    update(_renderer: PlanRenderer, _event: dashql.buffers.view.UpdateFragmentEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(_renderer: PlanRenderer, _vm: dashql.buffers.view.PlanViewModel, _p: dashql.buffers.view.PlanPipeline) { };
    registerOperator(_renderer: PlanRenderer, _op: PlanOperatorRenderer, _breaksPipeline: boolean) { }
    render(_renderer: PlanRenderer) { }

    update(_renderer: PlanRenderer, _event: dashql.buffers.view.UpdatePipelineEvent) { }
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

    public prepare(_renderer: PlanRenderer, _vm: dashql.buffers.view.PlanViewModel, edge: dashql.buffers.view.PlanOperatorEdge, parent: PlanOperatorRenderer, child: PlanOperatorRenderer) {
        this.parent = parent;
        this.child = child;
        this.parentPortCount = Math.max(edge.parentOperatorPortCount(), 1);
        this.parentPortIndex = edge.parentOperatorPortIndex();
    }
    public render(renderer: PlanRenderer) {
        const state = renderer.state;
        if (state == null) {
            return;
        }
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
        this.path = document.createElementNS(SVG_NS, 'path');
        this.path.setAttribute("d", edgePath);
        this.path.setAttribute("stroke-width", "1px");
        this.path.setAttribute("stroke", "black");
        this.path.setAttribute("fill", "transparent");
        this.path.setAttribute("pointer-events", "stroke");
        state.operatorEdgeLayer.appendChild(this.path);
    }

    public update(_renderer: PlanRenderer, _event: dashql.buffers.view.UpdateOperatorEdgeEvent) { }
}

export class PlanOperatorCrossEdgeRenderer {
    constructor() { }

    prepare(_renderer: PlanRenderer, _vm: dashql.buffers.view.PlanViewModel, _cross: dashql.buffers.view.PlanOperatorCrossEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }
    render(_renderer: PlanRenderer) { }

    update(_renderer: PlanRenderer, _event: dashql.buffers.view.UpdateOperatorCrossEdgeEvent) { }
}
