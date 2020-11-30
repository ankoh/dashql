import * as React from "react";
import * as core from "@dashql/core";
import classnames from 'classnames';

import * as d3 from 'd3';
import * as dagre from 'dagre';
import * as dagreD3 from 'dagre-d3';

import sx = core.proto.syntax;
import styles from './program_graph.module.css';

interface Props {
    program: core.parser.Program | null;
    className?: string
}

class ProgramGraph extends React.Component<Props> {
    /// Root node
    private svgNode = React.createRef<SVGSVGElement>();
    /// Group node
    private svgGraphNode = React.createRef<SVGSVGElement>();
    /// Zoom node
    private zoom = d3.zoom();

    private renderGraph() {
        if (this.props.program == null) {
            return;
        }
        const g = new dagre.graphlib.Graph().setGraph({nodesep: 30, ranksep: 30});
        this.props.program.iterateStatements((idx: number, stmt: core.parser.Statement) => {
            g.setNode(idx.toString(), {
                label: stmt.target_name_short || "?",
                class: styles.node,
            });
        });
        this.props.program.iterateDependencies((_idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {
                class: styles.edge,
                curve: d3.curveMonotoneY,
                arrowhead: 'none',
                label: ''
            });
        });

        const svgRoot: any = d3.select(this.svgNode.current!);
        const svgInner: any = d3.select(this.svgGraphNode.current!);
        const render = new dagreD3.render();

        // reset zoom
        svgRoot.call(this.zoom.transform, d3.zoomIdentity);

        // Draw undirected edges
        render.arrows().none = () => {};

        render(svgInner, g);

        // Setup zooming
        const svgBB = this.svgNode.current!.getBoundingClientRect();
        const innerBB = this.svgGraphNode.current!.getBoundingClientRect();
        const scale = Math.min(svgBB.width / innerBB.width, svgBB.height / (innerBB.height + 60));
        const xOffset = (svgBB.width - innerBB.width) / 2;
        const yOffset = (svgBB.height - innerBB.height) / 2;

        this.zoom
            .scaleExtent([scale, Infinity])
            .on('zoom', () => {
                svgInner.attr('transform', d3.event.transform);
            });
        svgRoot.call(this.zoom.translateBy, xOffset, yOffset);
        svgRoot.call(this.zoom.scaleTo, scale);

    }

    public render() {
        return (
            <div className={classnames(this.props.className)}>
                <svg ref={this.svgNode} className={styles.svg_root} width="100%" height="100%">
                    <g ref={this.svgGraphNode} />
                </svg>
            </div>
        );
    }

    componentDidMount() {
        this.renderGraph();
    }

    componentDidUpdate(_prev: Readonly<Props>): void {
        this.renderGraph();
    }

}

export default ProgramGraph;
