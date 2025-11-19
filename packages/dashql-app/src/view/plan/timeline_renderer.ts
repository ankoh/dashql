import * as dashql from '@ankoh/dashql-core';

import * as styles from './timeline_renderer.module.css';

const SVG_NS = "http://www.w3.org/2000/svg";

export class PlanPipelineRenderer {
    pipelinePath: SVGPathElement | null;

    constructor() {
        this.pipelinePath = null;
    }

    prepare(_renderer: PlanTimelineRenderer, vm: dashql.buffers.view.PlanViewModel, _p: dashql.buffers.view.PlanPipeline, _durationMS: BigInt, _predecessorPipelineCount: number, _predecessorPipelineDuration: BigInt) {
        vm.pipelinesLength();
    }
    updateTotalDuration(_totalDurationMS: BigInt) {

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
    /// The cursor bar (vertical line following the cursor)
    cursorBar: SVGPathElement | null = null;

    /// Constructor
    constructor() { }
    /// Reset the renderer
    public reset() {
        this.pipelines = [];
        this.cursorBar = null;
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
            this.mountToUnsafe();
        }
    }
    // Mount with previous checks that everything is not null
    protected mountToUnsafe() {
        this.mountPoint!.appendChild(this.state!.rootNode);

        // Setup mouse event listener to log cursor position and update cursor bar
        this.state!.rootContainer.addEventListener('mousemove', (event: MouseEvent) => {
            const rect = this.state!.rootContainer.getBoundingClientRect();
            const x = event.clientX - rect.left;

            // Update cursor bar position and make it visible
            if (this.cursorBar) {
                const height = rect.height;
                this.cursorBar.setAttribute('d', `M ${x} 0 L ${x} ${height}`);
                this.cursorBar.style.visibility = 'visible';
            }
        });

        // Hide cursor bar when mouse leaves the SVG
        this.state!.rootContainer.addEventListener('mouseleave', () => {
            if (this.cursorBar) {
                this.cursorBar.style.visibility = 'hidden';
            }
        });
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
        let totalDurationMs = BigInt(0);
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const stats = pipelineVM.executionStatistics();
            let durationMs = BigInt(0);
            if (stats) {
                let begin = stats.startedAt();
                let end = (stats.finishedAt() >= begin) ? stats.finishedAt() : begin;
                durationMs = end - begin;
            }
            const pipeline = this.pipelines[i];
            pipeline.prepare(this, vm, pipelineVM, durationMs, i, totalDurationMs);
            totalDurationMs += durationMs;
        }
        for (const pipeline of this.pipelines) {
            pipeline.updateTotalDuration(totalDurationMs);
        }

        // Construct rendering state
        if (this.state == null) {
            const rootNode = document.createElement("div");
            const rootSvgContainer = document.createElementNS(SVG_NS, 'svg');
            rootSvgContainer.style.width = '100%';
            rootSvgContainer.style.height = '100%';
            rootNode.className = styles.root;
            rootNode.appendChild(rootSvgContainer);

            this.state = {
                rootNode,
                rootContainer: rootSvgContainer,
            };
        }

        // Setup cursor bar
        this.cursorBar = document.createElementNS(SVG_NS, 'path');
        this.cursorBar.setAttribute('stroke', 'black');
        this.cursorBar.setAttribute('stroke-width', '2');
        this.cursorBar.setAttribute('fill', 'none');
        this.cursorBar.setAttribute('d', '');
        this.cursorBar.style.visibility = 'hidden';
        this.state.rootContainer.appendChild(this.cursorBar);

        // Invoke the renderers
        for (const pipeline of this.pipelines) {
            pipeline.render(this);
        }

        // Do we already have a mount point? Then add the root node
        if (this.mountPoint != null) {
            this.mountToUnsafe();
        }
    }
}
