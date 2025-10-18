import * as dashql from '@ankoh/dashql-core';

/// This file contains a plan renderer.
/// The plan renderer is deliberately implemented using raw DOM updates.
/// The goal is to potentially stream thousands of plan progress events and visualize them instantly.
///
/// This does not really work if we run with full react view consolidation across all plan nodes and edges.
/// We'd re-evaluate far too much from the virtual dom over and over again.
/// Users usually display the full plan so we can just render everything once and then be very fast with precise updates.

export class PlanRenderer {
    /// The plan stages
    protected stages: PlanStageRenderer[] = [];
    /// The plan pipelines
    protected pipelines: PlanPipelineRenderer[] = [];
    /// The plan nodes
    protected nodes: PlanNodeRenderer[] = [];
    /// The regular edge renderers
    protected edges: Map<bigint, PlanEdgeRenderer> = new Map();
    /// The cross edge renderer
    protected crossEdges: Map<bigint, PlanCrossEdgeRenderer> = new Map();

    /// Constructor
    constructor() { }
    // Reset the renderer
    reset() {
        this.nodes = [];
        this.stages = [];
        this.pipelines = [];
        this.edges = new Map();
        this.crossEdges = new Map();
    }
    /// Render the plan
    public render(viewModel: dashql.FlatBufferPtr<dashql.buffers.view.PlanViewModel>) {
        const vm = viewModel.read();

        for (let i = 0; i < vm.stagesLength(); ++i) {
            this.stages.push(new PlanStageRenderer());
        }
        for (let i = 0; i < vm.nodesLength(); ++i) {
            this.nodes.push(new PlanNodeRenderer());
        }
        for (let i = 0; i < vm.nodesLength(); ++i) {
            this.pipelines.push(new PlanPipelineRenderer());
        }

        const tmpPipeline = new dashql.buffers.view.PlanPipeline();
        const tmpStage = new dashql.buffers.view.PlanStage();
        const tmpNode = new dashql.buffers.view.PlanNode();
        const tmpEdge = new dashql.buffers.view.PlanEdge();
        const tmpCrossEdge = new dashql.buffers.view.PlanCrossEdge();

        for (let i = 0; i < vm.stagesLength(); ++i) {
            const stage = vm.stages(i, tmpStage)!;
            this.stages[stage.stageId()].prepare(stage);
        }
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(pipelineVM);
            this.stages[pipelineVM.stageId()].registerPipeline(pipeline);
        }
        for (let i = 0; i < vm.nodesLength(); ++i) {
            const nodeVM = vm.nodes(i, tmpNode)!;
            const node = this.nodes[nodeVM.nodeId()];
            node.prepare(nodeVM);
            this.pipelines[nodeVM.outputPipelineId()].registerAsOutputPipelineOf(node);
            this.stages[nodeVM.stageId()].registerNode(node);
        }
        for (let i = 0; i < vm.edgesLength(); ++i) {
            const edgeVM = vm.edges(i, tmpEdge)!;
            const sourceNode = this.nodes[edgeVM.sourceNode()];
            const targetNode = this.nodes[edgeVM.targetNode()];
            const edgeRenderer = new PlanEdgeRenderer(edgeVM, sourceNode, targetNode);
            this.edges.set(edgeVM.edgeId(), edgeRenderer);
        }
        for (let i = 0; i < vm.crossEdgesLength(); ++i) {
            const edgeVM = vm.crossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.nodes[edgeVM.sourceNode()];
            const targetNode = this.nodes[edgeVM.targetNode()];
            const edgeRenderer = new PlanCrossEdgeRenderer(edgeVM, sourceNode, targetNode);
            this.crossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }

        for (const stage of this.stages) {
            stage.render();
        }
        for (const pipeline of this.pipelines) {
            pipeline.render();
        }
        for (const node of this.nodes) {
            node.render();
        }
        for (const [_, edge] of this.edges) {
            edge.render();
        }
        for (const [_, edge] of this.crossEdges) {
            edge.render();
        }
    }

    /// Update the plan viewer with a set of change events
    public applyChangeEvents(eventsPtr: dashql.FlatBufferPtr<dashql.buffers.view.PlanChangeEvents>) {
        const eventsReader = eventsPtr.read();

        const tmpUpdateStageStats = new dashql.buffers.view.UpdateStageStatisticsEvent();
        const tmpUpdatePipelineStats = new dashql.buffers.view.UpdatePipelineStatisticsEvent();
        const tmpUpdateNodeStats = new dashql.buffers.view.UpdateNodeStatisticsEvent();
        const tmpUpdateEdgeStats = new dashql.buffers.view.UpdateEdgeStatisticsEvent();
        const tmpUpdateCrossEdgeStats = new dashql.buffers.view.UpdateCrossEdgeStatisticsEvent();

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
                case dashql.buffers.view.PlanChangeEvent.UpdateNodeStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateNodeStats)! as dashql.buffers.view.UpdateNodeStatisticsEvent;
                    this.nodes[s.nodeId()].updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateEdgeStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateEdgeStats)! as dashql.buffers.view.UpdateEdgeStatisticsEvent;
                    this.edges.get(s.edgeId())!.updateStatistics(s);
                    break;
                }
                case dashql.buffers.view.PlanChangeEvent.UpdateCrossEdgeStatisticsEvent: {
                    const s = eventsReader.events(i, tmpUpdateCrossEdgeStats)! as dashql.buffers.view.UpdateCrossEdgeStatisticsEvent;
                    this.crossEdges.get(s.edgeId())!.updateStatistics(s);
                    break;
                }
            }
        }
    }
}

export class PlanNodeRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanNode) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateNodeStatisticsEvent) { }
}

export class PlanStageRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanStage) { };
    registerNode(node: PlanNodeRenderer) { }
    registerPipeline(node: PlanPipelineRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateStageStatisticsEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanPipeline) { };
    registerAsOutputPipelineOf(node: PlanNodeRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdatePipelineStatisticsEvent) { }
}

export class PlanEdgeRenderer {
    constructor(vm: dashql.buffers.view.PlanEdge, source: PlanNodeRenderer, target: PlanNodeRenderer) { }

    prepare(vm: dashql.buffers.view.PlanEdge, source: PlanNodeRenderer, target: PlanNodeRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateEdgeStatisticsEvent) { }
}

export class PlanCrossEdgeRenderer {
    constructor(vm: dashql.buffers.view.PlanCrossEdge, source: PlanNodeRenderer, target: PlanNodeRenderer) { }

    prepare(vm: dashql.buffers.view.PlanCrossEdge, source: PlanNodeRenderer, target: PlanNodeRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateCrossEdgeStatisticsEvent) { }
}
