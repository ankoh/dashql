import * as dashql from '@ankoh/dashql-core';

/// This file contains a plan renderer.
/// The plan renderer is deliberately implemented using raw DOM updates.
/// The goal is to potentially stream thousands of plan progress events and visualize them instantly.
///
/// This does not really work if we run with full react view consolidation across all plan nodes and edges.
/// We'd re-evaluate far too much from the virtual dom over and over again.
/// Users usually display the full plan so we can just render everything once and then prioritize being very fast with updates.

export class PlanRenderer {
    /// The plan stages
    protected stages: PlanStageRenderer[] = [];
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
        this.stages = [];
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

        for (let i = 0; i < vm.stagesLength(); ++i) {
            this.stages.push(new PlanStageRenderer());
        }
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            this.operators.push(new PlanOperatorRenderer());
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            this.pipelines.push(new PlanPipelineRenderer());
        }

        const tmpPipeline = new dashql.buffers.view.PlanPipeline();
        const tmpPipelineEdge = new dashql.buffers.view.PlanPipelineEdge();
        const tmpStage = new dashql.buffers.view.PlanStage();
        const tmpOperator = new dashql.buffers.view.PlanOperator();
        const tmpEdge = new dashql.buffers.view.PlanOperatorEdge();
        const tmpCrossEdge = new dashql.buffers.view.PlanOperatorCrossEdge();

        for (let i = 0; i < vm.stagesLength(); ++i) {
            const stage = vm.stages(i, tmpStage)!;
            this.stages[stage.stageId()].prepare(vm, stage);
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(vm, pipelineVM);
            this.stages[pipelineVM.stageId()].registerPipeline(pipeline);
        }
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            const opVM = vm.operators(i, tmpOperator)!;
            const node = this.operators[opVM.operatorId()];
            node.prepare(vm, opVM);
            this.stages[opVM.stageId()].registerOperator(node);
        }
        for (let i = 0; i < vm.pipelineEdgesLength(); ++i) {
            const edgeVM = vm.pipelineEdges(i, tmpPipelineEdge)!;
            const op = this.operators[edgeVM.sourceOperator()];
            this.pipelines[edgeVM.pipelineId()].registerOperator(op, edgeVM.targetBreaksPipeline() != 0);
        }
        for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
            const edgeVM = vm.operatorEdges(i, tmpEdge)!;
            const sourceNode = this.operators[edgeVM.sourceOperator()];
            const targetNode = this.operators[edgeVM.targetOperator()];
            const edgeRenderer = new PlanOperatorEdgeRenderer(vm, edgeVM, sourceNode, targetNode);
            this.operatorEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
            const edgeVM = vm.operatorCrossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorCrossEdgeRenderer(vm, edgeVM, sourceNode, targetNode);
            this.operatorCrossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }

        if (this.rootNode != null) {
            this.rootNode.replaceChildren();
        } else {
            this.rootNode = document.createElement("div");
        }
        const renderingState: PlanRenderingState = {
            rootNode: this.rootNode,
            operatorLayer: document.createElement("div"),
        };
        for (const stage of this.stages) {
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

        this.rootNode.appendChild(renderingState.operatorLayer);

        if (this.mountPoint != null) {
            this.mountPoint.appendChild(this.rootNode);
        }
    }

    /// Update the plan viewer with a set of change events
    public applyChangeEvents(eventsPtr: dashql.FlatBufferPtr<dashql.buffers.view.PlanChangeEvents>) {
        const eventsReader = eventsPtr.read();

        const tmpUpdateStageStats = new dashql.buffers.view.UpdateStageStatisticsEvent();
        const tmpUpdatePipelineStats = new dashql.buffers.view.UpdatePipelineStatisticsEvent();
        const tmpUpdateNodeStats = new dashql.buffers.view.UpdateOperatorStatisticsEvent();
        const tmpUpdateEdgeStats = new dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent();
        const tmpUpdateCrossEdgeStats = new dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent();

        // Apply the change events
        for (let i = 0; i < eventsReader.eventsLength(); ++i) {
            switch (eventsReader.eventsType(i)) {
                case dashql.buffers.view.PlanChangeEvent.UpdateStageStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateStageStats)! as dashql.buffers.view.UpdateStageStatisticsEvent;
                    this.stages[s.stageId()].updateStatistics(s);
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
    rootNode: HTMLDivElement;
    operatorLayer: HTMLDivElement;
}

export class PlanOperatorRenderer {
    operatorNode: HTMLDivElement | null;
    operatorTypeName: string;
    labelNode: HTMLSpanElement | null;
    layoutInfo: dashql.buffers.view.PlanLayoutInfoT;

    constructor() {
        this.operatorNode = null;
        this.operatorTypeName = "unknown";
        this.labelNode = null;
        this.layoutInfo = new dashql.buffers.view.PlanLayoutInfoT();
    }

    prepare(vm: dashql.buffers.view.PlanViewModel, op: dashql.buffers.view.PlanOperator) {
        this.operatorTypeName = vm.stringDictionary(op.operatorTypeName());
        const layout = op.layout();
        if (layout != null) {
            op.layout()!.unpackTo(this.layoutInfo);
        }
    }

    render(state: PlanRenderingState) {
        this.operatorNode = document.createElement("div");
        this.operatorNode.style.position = "absolute";
        this.operatorNode.style.x = `${this.layoutInfo.x}px`;
        this.operatorNode.style.y = `${this.layoutInfo.y}px`;
        this.labelNode = document.createElement("span");
        this.labelNode.textContent = this.operatorTypeName;
        this.operatorNode.appendChild(this.labelNode);
        state.operatorLayer.appendChild(this.operatorNode);
    }

    updateStatistics(_event: dashql.buffers.view.UpdateOperatorStatisticsEvent) { }
}

export class PlanStageRenderer {
    constructor() { }

    prepare(_vm: dashql.buffers.view.PlanViewModel, _stage: dashql.buffers.view.PlanStage) { };
    registerOperator(_node: PlanOperatorRenderer) { }
    registerPipeline(_node: PlanPipelineRenderer) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdateStageStatisticsEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(_vm: dashql.buffers.view.PlanViewModel, _p: dashql.buffers.view.PlanPipeline) { };
    registerOperator(_op: PlanOperatorRenderer, _breaksPipeline: boolean) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdatePipelineStatisticsEvent) { }
}

export class PlanOperatorEdgeRenderer {
    constructor(_vm: dashql.buffers.view.PlanViewModel, _edge: dashql.buffers.view.PlanOperatorEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }

    prepare(_vm: dashql.buffers.view.PlanViewModel, _edge: dashql.buffers.view.PlanOperatorEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent) { }
}

export class PlanOperatorCrossEdgeRenderer {
    constructor(_vm: dashql.buffers.view.PlanViewModel, _cross: dashql.buffers.view.PlanOperatorCrossEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }

    prepare(_vm: dashql.buffers.view.PlanViewModel, _cross: dashql.buffers.view.PlanOperatorCrossEdge, _source: PlanOperatorRenderer, _target: PlanOperatorRenderer) { }
    render(_state: PlanRenderingState) { }

    updateStatistics(_event: dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent) { }
}
