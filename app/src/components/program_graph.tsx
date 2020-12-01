import * as React from "react";
import * as core from "@dashql/core";
import * as dagre from 'dagre';
import ReactFlow from 'react-flow-renderer';
import classNames from 'classNames';
import { FlowElement, Node, Edge } from 'react-flow-renderer';
import { proto } from "@dashql/core";

import sx = core.proto.syntax;
import styles from './program_graph.module.css';

function getStatementTypeLabel(type: proto.syntax.StatementType) {
    switch (type) {
        case proto.syntax.StatementType.CREATE_TABLE:
            return "CREATE TABLE";
        case proto.syntax.StatementType.CREATE_VIEW:
            return "CREATE VIEW";
        case proto.syntax.StatementType.EXTRACT_CSV:
            return "EXTRACT CSV";
        case proto.syntax.StatementType.EXTRACT_JSON:
            return "EXTRACT JSON";
        case proto.syntax.StatementType.LOAD_FILE:
            return "LOAD FILE";
        case proto.syntax.StatementType.LOAD_HTTP:
            return "LOAD HTTP";
        case proto.syntax.StatementType.PARAMETER:
            return "PARAMETER";
        case proto.syntax.StatementType.SELECT:
            return "SELECT";
        case proto.syntax.StatementType.SELECT_INTO:
            return "SELECT INTO";
        case proto.syntax.StatementType.VIZUALIZE:
            return "VISUALIZE";
        default:
            return "?";
    }
}

interface Props {
    program: core.parser.Program | null;
    className?: string
}

class ProgramGraph extends React.Component<Props> {
//    /// Root node
//    private svgNode = React.createRef<SVGSVGElement>();
//    /// Group node
//    private svgGraphNode = React.createRef<SVGSVGElement>();
//    /// Zoom node
//    private zoom = d3.zoom();
//
//    private renderGraph() {
//        if (this.props.program == null) {
//            return;
//        }
//
//        const g = new dagre.graphlib.Graph().setGraph({nodesep: 30, ranksep: 30});
//        this.props.program.iterateStatements((idx: number, stmt: core.parser.Statement) => {
//            const node = `
//                <div class="${styles.label}">
//                    <div class="${styles.label_type}">${getStatementTypeLabel(stmt.statement_type)}</div>
//                </div>
//            `;
//
//            g.setNode(idx.toString(), {
//                labelType: "html",
//                label: node,
//                class: styles.node
//            });
//        });
//        this.props.program.iterateDependencies((_idx: number, dep: sx.Dependency) => {
//            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {
//                class: styles.edge,
//                curve: d3.curveMonotoneY,
//                arrowhead: 'none',
//                label: ''
//            });
//        });
//
//        const svgRoot: any = d3.select(this.svgNode.current!);
//        const svgInner: any = d3.select(this.svgGraphNode.current!);
//        const render = new dagreD3.render();
//
//        // reset zoom
//        svgRoot.call(this.zoom.transform, d3.zoomIdentity);
//
//        // Draw undirected edges
//        render.arrows().none = () => {};
//
//        render(svgInner, g);
//
//        // Setup zooming
//        const svgBB = this.svgNode.current!.getBoundingClientRect();
//        const innerBB = this.svgGraphNode.current!.getBoundingClientRect();
//        const scale = Math.min(svgBB.width / innerBB.width, svgBB.height / (innerBB.height + 60));
//        const xOffset = (svgBB.width - innerBB.width) / 2;
//        const yOffset = (svgBB.height - innerBB.height) / 2;
//
//        this.zoom
//            .scaleExtent([scale, Infinity])
//            .on('zoom', () => {
//                svgInner.attr('transform', d3.event.transform);
//            });
//        svgRoot.call(this.zoom.translateBy, xOffset, yOffset);
//        svgRoot.call(this.zoom.scaleTo, scale);
//
//    }

    public render() {
        if (this.props.program == null) {
            return <div />;
        }

        const NODE_WIDTH = 120;
        const NODE_HEIGHT = 40;
        const NODE_SIZE = {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
        };

        // We use dagre to do the layouting and the render the graph with react-flow
        let nodes: Node[] = [];
        let edges: Edge[] = [];
        const g = new dagre.graphlib.Graph().setGraph({
            nodesep: 60,
            ranksep: 30
        });
        this.props.program.iterateStatements((idx: number, stmt: core.parser.Statement) => {
            const label = getStatementTypeLabel(stmt.statement_type);
            g.setNode(idx.toString(), {
                ...NODE_SIZE,
                label: label,
            });
            nodes.push({
                id: idx.toString(),
                style: { ...NODE_SIZE },
                data: { label: label },
                position: { x: 0, y: 0 }
            });
        });
        this.props.program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {});
            edges.push({
                id: "e-" + idx.toString(),
                source: dep.sourceStatement().toString(),
                target: dep.targetStatement().toString(),
            });
        });

        // Let dagre do the layouting
        dagre.layout(g);

        // Retrieve the node positions from dagre
        nodes = nodes.map(node => {
            const n = g.node(node.id);
            return {
                ...node,
                position: {
                    x: n.x - n.width / 2,
                    y: n.y - n.height / 2,
                }
            }
        });
        console.log(nodes);
        let elements = (nodes as FlowElement[]).concat(edges as FlowElement[]);

        return (
            <div className={classNames(this.props.className)}>
                <ReactFlow
                    elements={elements}
                    defaultPosition={[20, 20]}
                    nodesDraggable={false}
                    onLoad={(flow) => flow.fitView({padding: 0.2})}
                />
            </div>
        );
    }
}

export default ProgramGraph;
