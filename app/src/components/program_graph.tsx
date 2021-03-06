import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as dagre from 'dagre';
import ReactFlow, { Controls, FlowElement, Edge as EdgeData } from 'react-flow-renderer';
import classNames from 'classnames';
import { AppState, Dispatch } from '../model';
import { StatementNode, StatementNodeData } from './program_graph_node';
import { connect } from 'react-redux';
import { proto } from '@dashql/core';

import sx = proto.syntax;
import styles from './program_graph.module.css';

interface ExtendedEdgeData extends EdgeData {
    sourceId: number;
    targetId: number;
}

interface ProgramGraphProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    className?: string;
}

interface ProgramGraphState {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    nodes: StatementNodeData[];
    edges: ExtendedEdgeData[];
}

class ProgramGraph extends React.Component<ProgramGraphProps, ProgramGraphState> {
    constructor(props: ProgramGraphProps) {
        super(props);
        this.state = ProgramGraph.rebuild(props);
    }

    protected static rebuild(props: ProgramGraphProps): ProgramGraphState {
        if (!props.program) {
            return {
                program: null,
                programStatus: Immutable.List<core.model.StatementStatus>(),
                nodes: [],
                edges: [],
            };
        }

        const NODE_WIDTH = 40;
        const NODE_HEIGHT = 40;
        const NODE_SIZE = {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
        };

        // We use dagre to do the layouting and render the graph with react-flow afterwards
        let nodes: StatementNodeData[] = [];
        let edges: ExtendedEdgeData[] = [];
        const g = new dagre.graphlib.Graph().setGraph({
            nodesep: 40,
            ranksep: 80,
            rankdir: 'TB',
        });
        props.program.iterateStatements((idx: number, stmt: core.model.Statement) => {
            g.setNode(idx.toString(), {
                ...NODE_SIZE,
            });
            nodes.push({
                statementId: idx,
                id: idx.toString(),
                type: 'custom',
                style: { ...NODE_SIZE },
                position: { x: 0, y: 0 },
                data: {
                    statementType: stmt.statement_type,
                    actionStatus: proto.action.ActionStatusCode.NONE,
                },
            });
        });
        props.program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {});
            edges.push({
                id: 'e:' + idx.toString(),
                sourceId: dep.sourceStatement(),
                source: dep.sourceStatement().toString(),
                targetId: dep.sourceStatement(),
                target: dep.targetStatement().toString(),
                type: 'smoothstep',
                animated: false,
                style: {
                    opacity: 1.0,
                },
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
                },
            };
        });
        return ProgramGraph.updateState(props, {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
            edges: edges,
        });
    }

    protected static updateState(props: ProgramGraphProps, state: ProgramGraphState): ProgramGraphState {
        return {
            ...state,
            nodes: state.nodes.map(n => {
                const s = props.programStatus.get(n.statementId)!.status;
                if (n.data.actionStatus == s) {
                    return n;
                } else
                    return {
                        ...n,
                        data: {
                            statementType: n.data.statementType,
                            actionStatus: s,
                        },
                    };
            }),
            edges: state.edges.map(e => {
                const target = props.programStatus.get(e.targetId)!.status;
                let animated = false;
                let opacity = 1.0;
                switch (target) {
                    case proto.action.ActionStatusCode.RUNNING:
                    case proto.action.ActionStatusCode.BLOCKED:
                        animated = true;
                        break;
                    case proto.action.ActionStatusCode.NONE:
                        opacity = 0.5;
                        break;
                    case proto.action.ActionStatusCode.COMPLETED:
                    case proto.action.ActionStatusCode.FAILED:
                        animated = false;
                        break;
                }
                return {
                    ...e,
                    animated: animated,
                    style: {
                        opacity: opacity,
                    },
                };
            }),
        };
    }

    public static getDerivedStateFromProps(props: ProgramGraphProps, state: ProgramGraphState) {
        if (props.program !== state.program) {
            return ProgramGraph.rebuild(props);
        }
        return ProgramGraph.updateState(props, state);
    }

    public render() {
        if (this.props.program == null) {
            return <div />;
        }

        const FIT_PADDING = 0.3;
        return (
            <div className={classNames(styles.container, this.props.className)}>
                <ReactFlow
                    elements={(this.state.nodes as FlowElement[]).concat(this.state.edges as FlowElement[])}
                    defaultPosition={[20, 20]}
                    nodesDraggable={false}
                    onLoad={flow => flow.fitView({ padding: FIT_PADDING })}
                    nodeTypes={{
                        custom: StatementNode,
                    }}
                    nodesConnectable={false}
                >
                    <Controls className={styles.controls} showInteractive={false} showZoom={false} />
                </ReactFlow>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    program: state.core.plan?.program || null,
    programStatus: state.core.planProgramStatus,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramGraph);
