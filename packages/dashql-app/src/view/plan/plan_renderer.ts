import * as dashql from '@ankoh/dashql-core';
import * as styles from './plan_renderer.module.css';
import { U32_MAX } from '../../utils/numeric_limits.js';
import { buildEdgePathBetweenRectangles, PathBuilder, PathType, selectVerticalEdgeType } from '../../utils/graph_edges.js';
import { PlanRenderingSymbols } from './plan_renderer_symbols.js';

const SVG_NS = "http://www.w3.org/2000/svg";
const BORDER_COLOR = "hsl(210deg, 12.68%, 74.16%)";

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
    /// The pipeline edge layer
    pipelineEdgeLayer: SVGGElement;
    /// The edge path builder
    edgePathBuilder: PathBuilder;
}

export class PlanRenderer {
    /// The plan stages
    fragments: PlanFragmentRenderer[] = [];
    /// The plan pipelines
    pipelines: PlanPipelineRenderer[] = [];
    /// The plan nodes
    operators: PlanOperatorRenderer[] = [];
    /// The regular edge renderers
    operatorEdges: Map<bigint, PlanOperatorEdgeRenderer> = new Map();
    /// The cross edge renderer
    operatorCrossEdges: Map<bigint, PlanOperatorCrossEdgeRenderer> = new Map();

    /// The div where we add the root node as child
    mountPoint: HTMLDivElement | null = null;
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

        // Prepare operators first
        for (let i = 0; i < vm.operatorsLength(); ++i) {
            const opVM = vm.operators(i, tmpOperator)!;
            const node = this.operators[opVM.operatorId()];
            node.prepare(this, vm, opVM);
        }
        // Prepare operator edges after operators to know the references
        for (let i = 0; i < vm.operatorEdgesLength(); ++i) {
            const edgeVM = vm.operatorEdges(i, tmpEdge)!;
            const parentNode = this.operators[edgeVM.parentOperator()];
            const childNode = this.operators[edgeVM.childOperator()];
            const edgeRenderer = new PlanOperatorEdgeRenderer();
            edgeRenderer.prepare(this, vm, edgeVM, parentNode, childNode);
            this.operatorEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        // Draw cross-edges between the operators
        for (let i = 0; i < vm.operatorCrossEdgesLength(); ++i) {
            const edgeVM = vm.operatorCrossEdges(i, tmpCrossEdge)!;
            const sourceNode = this.operators[edgeVM.sourceNode()];
            const targetNode = this.operators[edgeVM.targetNode()];
            const edgeRenderer = new PlanOperatorCrossEdgeRenderer();
            edgeRenderer.prepare(this, vm, edgeVM, sourceNode, targetNode);
            this.operatorCrossEdges.set(edgeVM.edgeId(), edgeRenderer);
        }
        // Prepare pipelines after operators and edges to draw along paths
        for (let i = 0; i < vm.pipelinesLength(); ++i) {
            const pipelineVM = vm.pipelines(i, tmpPipeline)!;
            const pipeline = this.pipelines[pipelineVM.pipelineId()];
            pipeline.prepare(this, vm, pipelineVM, tmpPipelineEdge);
        }
        // Draw fragments after pipelines for bounding boxes
        for (let i = 0; i < vm.fragmentsLength(); ++i) {
            const stage = vm.fragments(i, tmpFragment)!;
            this.fragments[stage.fragmentId()].prepare(this, vm, stage);
        }

        if (this.state == null) {
            const rootNode = document.createElement("div");
            const rootSvgContainer = document.createElementNS(SVG_NS, 'svg');
            const operatorLayer = document.createElementNS(SVG_NS, 'g');
            const operatorEdgeLayer = document.createElementNS(SVG_NS, 'g');
            const pipelineEdgeLayer = document.createElementNS(SVG_NS, 'g');
            const edgePathBuilder = new PathBuilder();

            rootNode.className = styles.root;
            rootSvgContainer.classList.add(styles.root_svg);

            rootNode.appendChild(rootSvgContainer);
            rootSvgContainer.appendChild(pipelineEdgeLayer);
            rootSvgContainer.appendChild(operatorEdgeLayer);
            rootSvgContainer.appendChild(operatorLayer);

            const symbols = new PlanRenderingSymbols(rootSvgContainer, layoutConfig);
            this.state = {
                layoutConfig,
                rootNode,
                rootContainer: rootSvgContainer,
                symbols,
                operatorLayer,
                operatorEdgeLayer,
                pipelineEdgeLayer,
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
        this.operatorRect.setAttribute("rx", "6");
        this.operatorRect.setAttribute("ry", "6");
        this.operatorRect.setAttribute("fill", "white");
        this.operatorRect.setAttribute("stroke", BORDER_COLOR);
        this.operatorRect.setAttribute("stroke-width", "1px");
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
    render(_renderer: PlanRenderer) { }

    update(_renderer: PlanRenderer, _event: dashql.buffers.view.UpdateFragmentEvent) { }
}

class PipelineOutlineBuilder {
    parts: PathBuilder[];

    constructor() {
        this.parts = [];
    }
    clear() {
        this.parts = [];
    }
    add(path: PathBuilder) {
        this.parts.push(path);
    }
    render(): string {
        let out = "";
        for (let i = 0; i < this.parts.length; ++i) {
            const part = this.parts[i];
            const standalone = i == 0;
            const partRendered = part.render(standalone);
            out += partRendered;
        }
        if (this.parts.length > 0) {
            out += `L ${this.parts[0].path[0]} ${this.parts[0].path[1]}`;
        }
        return out;
    }
}

interface PipelineOutlinePart {
    forwards: PathBuilder;
    backwards: PathBuilder;
}

export class PlanPipelineRenderer {
    pipelinePathBuilder: PipelineOutlineBuilder;
    pipelinePath: SVGPathElement | null;

    constructor() {
        this.pipelinePathBuilder = new PipelineOutlineBuilder();
        this.pipelinePath = null;
    }

    prepare(renderer: PlanRenderer, vm: dashql.buffers.view.PlanViewModel, p: dashql.buffers.view.PlanPipeline, tmpEdge: dashql.buffers.view.PlanPipelineEdge) {
        if (p.edgeCount() == 0) {
            return;
        }
        let radius = 8;
        let pipelineWidth = 8;
        let padding = 4;

        const operatorOutlines = new Map<number, PipelineOutlinePart>();
        const edgeOutlines = new Map<bigint, PipelineOutlinePart>();
        const pipelineTraversal = new Map<number, number[]>();

        // Before we start, collect the pipeline edges
        const begin = p.edgesBegin();
        for (let i = 0; i < p.edgeCount(); ++i) {
            const edge = vm.pipelineEdges(begin + i, tmpEdge)!;
            const outbound = pipelineTraversal.get(edge.childOperator());
            let newOutbound: number[] = outbound ?? [];
            newOutbound.push(edge.parentOperator());
            if (!outbound) {
                pipelineTraversal.set(edge.childOperator(), newOutbound);
            }
        }

        // Then build all the outlines
        for (let i = 0; i < p.edgeCount(); ++i) {
            const edge = vm.pipelineEdges(begin + i, tmpEdge)!;
            // Build outlines for child and parent
            for (const oid of [edge.childOperator()!, edge.parentOperator()!]) {
                if (operatorOutlines.has(oid)) {
                    continue;
                }
                const op = renderer.operators[oid];
                const x = op.layoutRect.x;
                const y = op.layoutRect.y;
                const width = op.layoutRect.width + padding * 2;
                const height = op.layoutRect.height + padding * 2;
                let fwd = new PathBuilder();
                fwd.begin(x - pipelineWidth / 2, y + height / 2);
                fwd.push(x - width / 2 + radius, y + height / 2);
                fwd.push(x - width / 2, y + height / 2);
                fwd.push(x - width / 2, y + height / 2 - radius);
                fwd.push(x - width / 2, y - height / 2 + radius);
                fwd.push(x - width / 2, y - height / 2);
                fwd.push(x - width / 2 + radius, y - height / 2);
                fwd.push(x - pipelineWidth / 2, y - height / 2);
                fwd.finish(PathType.TWO_TURNS);
                let bwd = new PathBuilder();
                bwd.begin(x + pipelineWidth / 2, y - height / 2);
                bwd.push(x + width / 2 - radius, y - height / 2);
                bwd.push(x + width / 2, y - height / 2);
                bwd.push(x + width / 2, y - height / 2 + radius);
                bwd.push(x + width / 2, y + height / 2 - radius);
                bwd.push(x + width / 2, y + height / 2);
                bwd.push(x + width / 2 - radius, y + height / 2);
                bwd.push(x + pipelineWidth / 2, y + height / 2);
                bwd.finish(PathType.TWO_TURNS);
                operatorOutlines.set(oid, {
                    forwards: fwd,
                    backwards: bwd,
                });
            }

            // Build outlines for edge
            {
                const child = renderer.operators[edge.childOperator()!];
                const parent = renderer.operators[edge.parentOperator()!];
                const childX = child.layoutRect.x;
                const childY = child.layoutRect.y;
                const childWidth = child.layoutRect.width + padding * 2;
                const childHeight = child.layoutRect.height + padding * 2;
                const parentX = parent.layoutRect.x;
                const parentY = parent.layoutRect.y;
                const parentWidth = parent.layoutRect.width + padding * 2;
                const parentHeight = parent.layoutRect.height + padding * 2;
                const fwdEdgeType = selectVerticalEdgeType(childX, childY, parentX, parentY);
                const fwdEdge = buildEdgePathBetweenRectangles(new PathBuilder(), fwdEdgeType, childX, childY, parentX, parentY, childWidth, childHeight, parentWidth, parentHeight, radius, pipelineWidth / 2);
                const bwdEdgeType = selectVerticalEdgeType(parentX, parentY, childX, childY); // XXX "reverse" the fwd edge type
                const bwdEdge = buildEdgePathBetweenRectangles(new PathBuilder(), bwdEdgeType, parentX, parentY, childX, childY, parentWidth, parentHeight, childWidth, childHeight, radius, pipelineWidth / 2);
                const edgeKey = (BigInt(edge.childOperator()!) << BigInt(32)) | BigInt(edge.parentOperator()!);
                edgeOutlines.set(edgeKey, { forwards: fwdEdge, backwards: bwdEdge });
            }
        }

        this.pipelinePathBuilder.clear();
        type DFSState = {
            op: number;
            opOutlines: PipelineOutlinePart;
            producerOp: number | null;
            producerEdgeOutlines: PipelineOutlinePart | null;
            visited: boolean;
        };

        const rootEdge = vm.pipelineEdges(begin, tmpEdge)!;
        const rootOpId = rootEdge.childOperator()!;
        const pending: DFSState[] = [{
            op: rootOpId,
            opOutlines: operatorOutlines.get(rootOpId)!,
            producerOp: null,
            producerEdgeOutlines: null,
            visited: false,
        }];
        while (pending.length > 0) {
            let back = pending[pending.length - 1];
            if (back.visited) {
                pending.pop();
                this.pipelinePathBuilder.add(back.opOutlines.backwards);
                if (back.producerEdgeOutlines != null) {
                    this.pipelinePathBuilder.add(back.producerEdgeOutlines.backwards);
                }
            } else {
                back.visited = true;
                this.pipelinePathBuilder.add(back.opOutlines.forwards);
                const nextOps = pipelineTraversal.get(back.op);
                for (let i = 0; i < (nextOps?.length ?? 0); ++i) {
                    const n = nextOps!;
                    const consumerOpId = n[n.length - 1 - i];
                    const edgeKey = (BigInt(back.op) << BigInt(32)) | BigInt(consumerOpId);
                    const edge = edgeOutlines.get(edgeKey)!;
                    this.pipelinePathBuilder.add(edge.forwards)!;
                    pending.push({
                        op: consumerOpId,
                        opOutlines: operatorOutlines.get(consumerOpId)!,
                        producerOp: back.op,
                        producerEdgeOutlines: edge,
                        visited: false,
                    })
                }
            }
        }
    };
    render(_renderer: PlanRenderer) {
        this.pipelinePath = document.createElementNS(SVG_NS, 'path');
        this.pipelinePath.setAttribute("d", this.pipelinePathBuilder.render());
        this.pipelinePath.setAttribute("stroke", "hsl(210deg, 12.68%, 74.16%)");
        this.pipelinePath.setAttribute("stroke-width", "1px");
        this.pipelinePath.setAttribute("fill", "rgba(220, 220, 220, 0.5)");
        this.pipelinePath.setAttribute("pointer-events", "stroke");
        this.pipelinePath.setAttribute("display", "none");
    }

    update(renderer: PlanRenderer, event: dashql.buffers.view.UpdatePipelineEvent) {
        if (!this.pipelinePath || !renderer.state) {
            return;
        }
        if (event.executionStatus() == dashql.buffers.view.PlanExecutionStatus.RUNNING) {
            if (this.pipelinePath.parentNode == null) {
                this.pipelinePath.setAttribute("display", "inline");
                renderer.state.pipelineEdgeLayer.append(this.pipelinePath);
            }
        }
        if (event.executionStatus() == dashql.buffers.view.PlanExecutionStatus.SUCCEEDED && this.pipelinePath.parentNode != null) {
            this.pipelinePath.remove();
            this.pipelinePath.setAttribute("display", "none");
        }
    }
}

export class PlanOperatorEdgeRenderer {
    parent: PlanOperatorRenderer | null;
    child: PlanOperatorRenderer | null;
    path: SVGPathElement | null;

    constructor() {
        this.parent = null;
        this.child = null;
        this.path = null;
    }

    public prepare(_renderer: PlanRenderer, _vm: dashql.buffers.view.PlanViewModel, _edge: dashql.buffers.view.PlanOperatorEdge, parent: PlanOperatorRenderer, child: PlanOperatorRenderer) {
        this.parent = parent;
        this.child = child;
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
        this.path.setAttribute("d", edgePath.render());
        this.path.setAttribute("stroke", BORDER_COLOR);
        this.path.setAttribute("stroke-width", "1px");
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
