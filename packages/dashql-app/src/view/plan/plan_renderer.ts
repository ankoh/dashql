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
    protected operators: PlanOperatorRenderer[] = [];
    /// The regular edge renderers
    protected operatorEdges: Map<bigint, PlanOperatorEdgeRenderer> = new Map();
    /// The cross edge renderer
    protected operatorCrossEdges: Map<bigint, PlanOperatorCrossEdgeRenderer> = new Map();

    /// Constructor
    constructor() { }
    // Reset the renderer
    reset() {
        this.operators = [];
        this.stages = [];
        this.pipelines = [];
        this.operatorEdges = new Map();
        this.operatorCrossEdges = new Map();
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
        const tmpStage = new dashql.buffers.view.PlanStage();
        const tmpOperator = new dashql.buffers.view.PlanOperator();
        const tmpOperatorPipeline = new dashql.buffers.view.PlanOperatorPipeline();
        const tmpEdge = new dashql.buffers.view.PlanOperatorEdge();
        const tmpCrossEdge = new dashql.buffers.view.PlanOperatorCrossEdge();

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
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            const opVM = vm.operators(i, tmpOperator)!;
            const node = this.operators[opVM.operatorId()];
            node.prepare(opVM);
            this.stages[opVM.stageId()].registerOperator(node);
        }
        for (let i = 0; i < vm.operatorPipelinesLength(); ++i) {
            const opPipelineVM = vm.operatorPipelines(i, tmpOperatorPipeline)!;
            const op = this.operators[opPipelineVM.operatorId()];
            this.pipelines[opPipelineVM.pipelineId()].registerOperator(op, opPipelineVM.behavior());
        }
        for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
            const edgeVM = vm.operatorEdges(i, tmpEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorEdgeRenderer(edgeVM, sourceNode, targetNode);
            this.operatorEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
            const edgeVM = vm.operatorCrossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorCrossEdgeRenderer(edgeVM, sourceNode, targetNode);
            this.operatorCrossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }

        for (const stage of this.stages) {
            stage.render();
        }
        for (const pipeline of this.pipelines) {
            pipeline.render();
        }
        for (const op of this.operators) {
            op.render();
        }
        for (const [_, edge] of this.operatorEdges) {
            edge.render();
        }
        for (const [_, crossEdge] of this.operatorCrossEdges) {
            crossEdge.render();
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

export class PlanOperatorRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanOperator) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateOperatorStatisticsEvent) { }
}

export class PlanStageRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanStage) { };
    registerOperator(node: PlanOperatorRenderer) { }
    registerPipeline(node: PlanPipelineRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateStageStatisticsEvent) { }
}

export class PlanPipelineRenderer {
    constructor() { }

    prepare(vm: dashql.buffers.view.PlanPipeline) { };
    registerOperator(op: PlanOperatorRenderer, behavior: dashql.buffers.view.PlanPipelineOperatorBehavior) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdatePipelineStatisticsEvent) { }
}

export class PlanOperatorEdgeRenderer {
    constructor(vm: dashql.buffers.view.PlanOperatorEdge, source: PlanOperatorRenderer, target: PlanOperatorRenderer) { }

    prepare(vm: dashql.buffers.view.PlanOperatorEdge, source: PlanOperatorRenderer, target: PlanOperatorRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateOperatorEdgeStatisticsEvent) { }
}

export class PlanOperatorCrossEdgeRenderer {
    constructor(vm: dashql.buffers.view.PlanOperatorCrossEdge, source: PlanOperatorRenderer, target: PlanOperatorRenderer) { }

    prepare(vm: dashql.buffers.view.PlanOperatorCrossEdge, source: PlanOperatorRenderer, target: PlanOperatorRenderer) { }
    render() { }

    updateStatistics(event: dashql.buffers.view.UpdateOperatorCrossEdgeStatisticsEvent) { }
}
