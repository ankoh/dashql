import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as dagre from 'dagre';
import ReactFlow, { ReactFlowProvider, FlowElement, Edge as EdgeData, useStoreState } from 'react-flow-renderer';
import classNames from 'classnames';
import { AppState, Dispatch } from '../../model';
import { StatementNode, StatementNodeData } from './progress_graph_node';
import { connect } from 'react-redux';
import { proto } from '@dashql/core';

import sx = proto.syntax;
import styles from './progress_graph.module.css';

const NODE_WIDTH = 16;
const NODE_HEIGHT = 16;
const NODE_SIZE = {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
};
const NODE_OPACITY = 0.3;

interface ExtendedEdgeData extends EdgeData {
    sourceId: number;
    targetId: number;
    data: {
        focused: boolean;
    };
}

interface ProgressGraphProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    className?: string;
    card: core.model.Card;
}

interface ProgressGraphState {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    nodes: StatementNodeData[];
    edges: ExtendedEdgeData[];
    center: [number, number];
}

class ProgressGraph extends React.Component<ProgressGraphProps, ProgressGraphState> {
    constructor(props: ProgressGraphProps) {
        super(props);
        this.state = ProgressGraph.rebuild(props);
    }

    protected static rebuild(props: ProgressGraphProps): ProgressGraphState {
        if (!props.program) {
            return {
                program: null,
                programStatus: Immutable.List<core.model.StatementStatus>(),
                nodes: [],
                edges: [],
                center: [0, 0],
            };
        }

        // Collect all transitive dependencies
        const focus = new core.utils.NativeBitmap(props.program.buffer.statementsLength());
        const depDFS: number[] = [];
        const depMapping = props.program.statementDependencies;
        focus.set(props.card.statementID);
        depDFS.push(props.card.statementID);
        while (depDFS.length > 0) {
            const top = depDFS.pop()!;
            const deps = depMapping.get(top);
            if (!deps) continue;
            for (const dep of deps) {
                if (!focus.isSet(dep)) {
                    focus.set(dep);
                    depDFS.push(dep);
                }
            }
        }

        // We use dagre to do the layouting and render the graph with react-flow afterwards
        let nodes: StatementNodeData[] = [];
        const edges: ExtendedEdgeData[] = [];
        const g = new dagre.graphlib.Graph().setGraph({
            nodesep: 24,
            ranksep: 24,
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
                    actionStatus: proto.action.ActionStatusCode.PENDING,
                    focused: focus.isSet(idx),
                },
            });
        });
        props.program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {});
            edges.push({
                id: 'e:' + idx.toString(),
                sourceId: dep.sourceStatement(),
                source: dep.sourceStatement().toString(),
                targetId: dep.targetStatement(),
                target: dep.targetStatement().toString(),
                type: 'step',
                data: {
                    focused: focus.isSet(dep.targetStatement()) && focus.isSet(dep.sourceStatement()),
                },
            });
        });

        // Let dagre do the layouting
        dagre.layout(g);

        // Retrieve the node positions from dagre
        let maxX = 0;
        let maxY = 0;
        nodes = nodes.map(node => {
            const n = g.node(node.id);
            maxX = Math.max(maxX, n.x);
            maxY = Math.max(maxY, n.y);
            return {
                ...node,
                position: {
                    x: n.x - n.width / 2,
                    y: n.y - n.height / 2,
                },
            };
        });
        return ProgressGraph.updateState(props, {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
            edges: edges,
            center: [maxX / 2.0, maxY / 2.0],
        });
    }

    protected static updateState(props: ProgressGraphProps, state: ProgressGraphState): ProgressGraphState {
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
                            focused: n.data.focused,
                        },
                    };
            }),
            edges: state.edges.map(e => {
                const target = props.programStatus.get(e.targetId)!.status;
                let opacity = e.data.focused ? 1.0 : NODE_OPACITY;
                switch (target) {
                    case proto.action.ActionStatusCode.RUNNING:
                    case proto.action.ActionStatusCode.BLOCKED:
                        break;
                    case proto.action.ActionStatusCode.PENDING:
                        opacity = NODE_OPACITY;
                        break;
                    case proto.action.ActionStatusCode.COMPLETED:
                    case proto.action.ActionStatusCode.FAILED:
                        break;
                }
                return {
                    ...e,
                    style: {
                        opacity,
                        strokeWidth: 2,
                        stroke: 'rgb(80, 80, 80)',
                    },
                };
            }),
        };
    }

    public static getDerivedStateFromProps(props: ProgressGraphProps, state: ProgressGraphState) {
        if (props.program !== state.program) {
            return ProgressGraph.rebuild(props);
        }
        return ProgressGraph.updateState(props, state);
    }

    protected static CenterFlow(props: { center: [number, number]; children: React.ReactElement }) {
        // We update the transform in-place from the flow provider before it reaches ReactFlow.
        // This is actually a bit hacky since it violates the state immutability but works.
        // React-Flow does not offer an easy way to auto center the view at the moment.
        // XXX Maybe discuss in issue?
        useStoreState(s => {
            s.transform = [s.width / 2.0 - props.center[0], s.height / 2.0 - props.center[1], 1.0];
        });
        return props.children;
    }

    public render() {
        if (this.props.program == null) {
            return <div />;
        }
        return (
            <div className={classNames(styles.container, this.props.className)}>
                <ReactFlowProvider>
                    <ProgressGraph.CenterFlow center={this.state.center}>
                        <ReactFlow
                            elements={(this.state.nodes as FlowElement[]).concat(this.state.edges as FlowElement[])}
                            nodesDraggable={false}
                            paneMoveable={false}
                            zoomOnScroll={false}
                            zoomOnDoubleClick={false}
                            selectNodesOnDrag={false}
                            elementsSelectable={false}
                            nodesConnectable={false}
                            nodeTypes={{
                                custom: StatementNode,
                            }}
                        />
                    </ProgressGraph.CenterFlow>
                </ReactFlowProvider>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    program: state.core.plan?.program || null,
    programStatus: state.core.planState.status,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(ProgressGraph);
