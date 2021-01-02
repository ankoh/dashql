import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as dagre from 'dagre';
import { AppState, Dispatch } from '../model';
import { connect } from 'react-redux';
import ReactFlow, { Controls, FlowElement, Edge as EdgeData } from 'react-flow-renderer';
import { StatementNode, StatementNodeData } from './program_graph_node';
import classNames from 'classnames';
import { proto } from '@dashql/core';

import sx = proto.syntax;
import styles from './program_graph.module.css';

interface ProgramGraphProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    className?: string;
}

interface ProgramGraphState {
    program: core.model.Program | null,
    programStatus: Immutable.List<core.model.StatementStatus>,
    nodes: StatementNodeData[],
    edges: EdgeData[],
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
            }
        }

        const NODE_WIDTH = 120;
        const NODE_HEIGHT = 70;
        const NODE_SIZE = {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
        };

        // We use dagre to do the layouting and the render the graph with react-flow
        let nodes: StatementNodeData[] = [];
        let edges: EdgeData[] = [];
        const g = new dagre.graphlib.Graph().setGraph({
            nodesep: 60,
            ranksep: 40,
            rankdir: 'LR',
        });
        props.program.iterateStatements((idx: number, stmt: core.model.Statement) => {
            g.setNode(idx.toString(), {
                ...NODE_SIZE,
            });
            nodes.push({
                id: idx.toString(),
                type: 'custom',
                style: { ...NODE_SIZE },
                position: { x: 0, y: 0 },
                data: {
                    statementType: stmt.statement_type,
                    actionStatus: props.programStatus.get(idx)?.status || proto.action.ActionStatusCode.NONE,
                },
            });
        });
        props.program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {});
            edges.push({
                id: 'e:' + idx.toString(),
                source: dep.sourceStatement().toString(),
                target: dep.targetStatement().toString(),
                type: 'smoothstep',
                animated: dep.sourceStatement() == 3, // XXX
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
        return {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
            edges: edges,
        };
    }

    protected static updateState(props: ProgramGraphProps, state: ProgramGraphState): ProgramGraphState {
        props.programStatus.forEach((s, i) => {
            const n = state.nodes[i];
            if (n.data.actionStatus != s.status) {
                state.nodes[i] = {
                    ...n,
                    data: {
                        statementType: n.data.statementType,
                        actionStatus: s.status
                    }
                };
            }
        });
        return state;
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

        const FIT_PADDING = 0.2;
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
    program: state.core.program,
    programStatus: state.core.programStatus,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgramGraph);
