import * as dashql from '@ankoh/dashql-core';
import * as styles from './plan_renderer.module.css';
import { U32_MAX } from '../../utils/numeric_limits.js';
import { buildEdgePathBetweenRectangles, EdgePathBuilder, selectVerticalEdgeType } from '../../utils/graph_edges.js';

/// This file contains a plan renderer.
/// The plan renderer is deliberately implemented using raw DOM updates.
/// The goal is to potentially stream hundreds of plan progress events and visualize them instantly.
///
/// This does not really work if we run with full react view consolidation across all plan nodes and edges.
/// We'd re-evaluate far too much from the virtual dom over and over again.
/// Users usually display the full plan so we can just render everything once and then prioritize being very fast with updates.

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
    /// The current root node (if rendered)
    protected rootNode: HTMLDivElement | null = null;

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
        if (this.mountPoint != prev && this.mountPoint != null && this.rootNode != null) {
            this.mountPoint.appendChild(this.rootNode);
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

        if (this.rootNode != null) {
            this.rootNode.replaceChildren();
        } else {
            this.rootNode = document.createElement("div");
            this.rootNode.className = styles.root;
        }
        const renderingState: PlanRenderingState = {
            layoutConfig,
            rootNode: this.rootNode,
            operatorLayer: document.createElement("div"),
            edgePathBuilder: new EdgePathBuilder(),
        };

        // Prepare operator layer
        const vmRect = vm.layoutRect();
        renderingState.operatorLayer.style.position = "relative";
        if (vmRect != null) {
            renderingState.operatorLayer.style.width = `${vmRect.width()}px`;
            renderingState.operatorLayer.style.height = `${vmRect.height()}px`;
        }

        // Invoke the renderers
        for (const stage of this.fragments) {
            stage.render(renderingState);
        }
        for (const pipeline of this.pipelines) {
            pipeline.render(renderingState);
        }
        for (const op of this.operators) {
            op.render(renderingState);
        }
        for (const [_, edge] of this.operatorEdges) {
            edge.render(renderingState);
        }
        for (const [_, crossEdge] of this.operatorCrossEdges) {
            crossEdge.render(renderingState);
        }

        // Add the operator layer to the root node
        this.rootNode.appendChild(renderingState.operatorLayer);

        if (this.mountPoint != null) {
            this.mountPoint.appendChild(this.rootNode);
        }
    }

    /// Update the plan viewer with a set of change events
    public applyChangeEvents(eventsPtr: dashql.FlatBufferPtr<dashql.buffers.view.PlanChangeEvents>) {
        const eventsReader = eventsPtr.read();

        const tmpUpdateFragmentStats = new dashql.buffers.view.UpdateFragmentStatisticsEvent();
        const tmpUpdatePipelineStats = new dashql.buffers.view.UpdatePipelineStatisticsEvent();
        const tmpUpdateNodeStats = new dashql.buffers.view.UpdateOperatorStatisticsEvent();
        const tmpUpdateEdgeStats = new dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent();
        const tmpUpdateCrossEdgeStats = new dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent();

        // Apply the change events
        for (let i = 0; i < eventsReader.eventsLength(); ++i) {
            switch (eventsReader.eventsType(i)) {
                case dashql.buffers.view.PlanChangeEvent.UpdateFragmentStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateFragmentStats)! as dashql.buffers.view.UpdateFragmentStatisticsEvent;
                    this.fragments[s.fragmentId()].updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdatePipelineStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdatePipelineStats)! as dashql.buffers.view.UpdatePipelineStatisticsEvent;
                    this.pipelines[s.pipelineId()].updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateNodeStats)! as dashql.buffers.view.UpdateOperatorStatisticsEvent;
                    this.operators[s.operatorId()].updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorEdgeStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateEdgeStats)! as dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent;
                    this.operatorEdges.get(s.operatorEdgeId())!.updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateOperatorCrossEdgeStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateCrossEdgeStats)! as dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent;
                    this.operatorCrossEdges.get(s.operatorCrossEdgeId())!.updateStatistics(s);
                    break;
                }
            }
        }
    }
}

export interface PlanRenderingState {
    layoutConfig: dashql.buffers.view.DerivedPlanLayoutConfigT;
    rootNode: HTMLDivElement;
    operatorLayer: HTMLDivElement;
    edgePathBuilder: EdgePathBuilder;
}

function readString(vm: dashql.buffers.view.PlanViewModel, id: number): string | null {
    return id != U32_MAX ? vm.stringDictionary(id) : null;
}

export class PlanOperatorRenderer {
    operatorNode: HTMLDivElement | null;
    operatorTypeName: string | null;
    operatorLabel: string | null;
    labelNode: HTMLSpanElement | null;
    layoutRect: dashql.buffers.view.PlanLayoutRectT;

    constructor() {
        this.operatorNode = null;
        this.operatorTypeName = null;
        this.operatorLabel = null;
        this.labelNode = null;
        this.layoutRect = new dashql.buffers.view.PlanLayoutRectT();
    }

    public getLayoutRect() { return this.layoutRect; }

    public prepare(config: dashql.buffers.view.DerivedPlanLayoutConfigT, vm: dashql.buffers.view.PlanViewModel, op: dashql.buffers.view.PlanOperator) {
        this.operatorTypeName = readString(vm, op.operatorTypeName());
        this.operatorLabel = readString(vm, op.operatorLabel()) ?? this.operatorTypeName;
        const layout = op.layoutRect();
        if (layout != null) {
            op.layoutRect()!.unpackTo(this.layoutRect);
        }
    }

    public render(state: PlanRenderingState) {
        this.operatorNode = document.createElement("div");
        this.operatorNode.className = styles.operator_node;
        this.operatorNode.style.position = "absolute";
        this.operatorNode.style.left = `${this.layoutRect.x}px`;
        this.operatorNode.style.top = `${this.layoutRect.y}px`;
        this.operatorNode.style.height = `${this.layoutRect.height}px`;
        this.operatorNode.style.width = `${this.layoutRect.width}px`;
        this.labelNode = document.createElement("span");
        this.labelNode.textContent = this.operatorLabel;
        this.operatorNode.appendChild(this.labelNode);
        state.operatorLayer.appendChild(this.operatorNode);
    }

    public updateStatistics(_event: dashql.buffers.view.UpdateOperatorStatisticsEvent) { }
}

export class PlanFragmentRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _stage: dashql.buffers.view.PlanFragment) { };
    registerOperator(_node: PlanOperatorRenderer) { }
    registerPipeline(_node: PlanPipelineRenderer) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdateFragmentStatisticsEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _p: dashql.buffers.view.PlanPipeline) { };
    registerOperator(_op: PlanOperatorRenderer, _breaksPipeline: boolean) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdatePipelineStatisticsEvent) { }
}

export class PlanOperatorEdgeRenderer {
    parent: PlanOperatorRenderer | null;
    child: PlanOperatorRenderer | null;

    constructor() {
        this.parent = null;
        this.child = null;
    }

    public prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _edge: dashql.buffers.view.PlanOperatorEdge, parent: PlanOperatorRenderer, child: PlanOperatorRenderer) {
        this.parent = parent;
        this.child = child;
    }
    public render(state: PlanRenderingState) {
        const parentRect = this.parent!.getLayoutRect();
        const parentY = parentRect.y + parentRect.height / 2;
        const parentX = parentRect.x;

        const childRect = this.child!.getLayoutRect();
        const childY = childRect.y + childRect.height / 2;
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
    }

    public updateStatistics(_event: dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent) { }
}

export class PlanOperatorCrossEdgeRenderer {
    constructor() { }

    prepare(_config: dashql.buffers.view.DerivedPlanLayoutConfigT, _vm: dashql.buffers.view.PlanViewModel, _cross: dashql.buffers.view.PlanOperatorCrossEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent) { }
}
