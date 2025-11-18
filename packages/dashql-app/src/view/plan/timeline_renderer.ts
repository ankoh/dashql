import * as dashql from '@ankoh/dashql-core';

import * as styles from './timeline_renderer.module.css';

const SVG_NS = "http://www.w3.org/2000/svg";

export class PlanPipelineRenderer {
    pipelinePath: SVGPathElement | null;

    constructor() {
        this.pipelinePath = null;
    }

    prepare(_renderer: PlanTimelineRenderer, _vm: dashql.buffers.view.PlanViewModel, p: dashql.buffers.view.PlanPipeline) {
    }
    render(_renderer: PlanTimelineRenderer) { }
}

export interface PlanTimelineRenderingState {
    /// The root ndoe
    rootNode: HTMLDivElement;
    /// The root center node
    rootContainer: SVGElement;
}

export class PlanTimelineRenderer {
    /// The div where we add the root node as child
    mountPoint: HTMLDivElement | null = null;
    /// The current renderer output (if rendered)
    state: PlanTimelineRenderingState | null = null;
    /// The plan pipelines
    pipelines: PlanPipelineRenderer[] = [];

    /// Constructor
    constructor() { }
    /// Reset the renderer
    public reset() {
        this.pipelines = [];
        if (this.state != null) {
            this.state.rootNode.remove();
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

        // Collect pipelines
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            this.pipelines.push(new PlanPipelineRenderer());
        }

        // Prepare pipelines
        const tmpPipeline = new dashql.buffers.view.PlanPipeline();
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(this, vm, pipelineVM);
        }

        // Construct rendering state
        if (this.state == null) {
            const rootNode = document.createElement("div");
            const rootSvgContainer = document.createElementNS(SVG_NS, 'svg');
            rootNode.className = styles.root;

            this.state = {
                rootNode,
                rootContainer: rootSvgContainer,
            };
        }

        // Invoke the renderers
        for (const pipeline of this.pipelines) {
            pipeline.render(this);
        }

        // Do we already have a mount point? Then add the root node
        if (this.mountPoint != null) {
            this.mountPoint.appendChild(this.state.rootNode);
        }
    }
}
