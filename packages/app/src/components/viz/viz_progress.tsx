import * as Immutable from 'immutable';
import * as React from 'react';
import * as core from '@dashql/core';
import * as dagre from 'dagre';
import ReactFlow, {
    ReactFlowProvider,
    FlowElement,
    Edge as EdgeData,
    useStoreState,
    useStoreActions,
} from 'react-flow-renderer';
import classNames from 'classnames';
import { AppState, Dispatch } from '../../model';
import { StatementNode, StatementNodeData } from './viz_progress_node';
import { connect, useStore } from 'react-redux';
import { proto } from '@dashql/core';

import sx = proto.syntax;
import styles from './viz_progress.module.css';

const NODE_WIDTH = 16;
const NODE_HEIGHT = 16;
const NODE_SIZE = {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
};

interface ExtendedEdgeData extends EdgeData {
    sourceId: number;
    targetId: number;
}

interface VizProgressProps {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    className?: string;
    vizInfo: core.model.VizInfo;
}

interface VizProgressState {
    program: core.model.Program | null;
    programStatus: Immutable.List<core.model.StatementStatus>;
    nodes: StatementNodeData[];
    edges: ExtendedEdgeData[];
    center: [number, number];
}

class VizProgress extends React.Component<VizProgressProps, VizProgressState> {
    constructor(props: VizProgressProps) {
        super(props);
        this.state = VizProgress.rebuild(props);
    }

    protected static rebuild(props: VizProgressProps): VizProgressState {
        if (!props.program) {
            return {
                program: null,
                programStatus: Immutable.List<core.model.StatementStatus>(),
                nodes: [],
                edges: [],
                center: [0, 0],
            };
        }

        // We use dagre to do the layouting and render the graph with react-flow afterwards
        let nodes: StatementNodeData[] = [];
        let edges: ExtendedEdgeData[] = [];
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
                type: 'step',
                animated: false,
                style: {
                    opacity: 1.0,
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
        return VizProgress.updateState(props, {
            program: props.program,
            programStatus: props.programStatus,
            nodes: nodes,
            edges: edges,
            center: [maxX / 2.0, maxY / 2.0],
        });
    }

    protected static updateState(props: VizProgressProps, state: VizProgressState): VizProgressState {
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

    public static getDerivedStateFromProps(props: VizProgressProps, state: VizProgressState) {
        if (props.program !== state.program) {
            return VizProgress.rebuild(props);
        }
        return VizProgress.updateState(props, state);
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
                    <VizProgress.CenterFlow center={this.state.center}>
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
                    </VizProgress.CenterFlow>
                </ReactFlowProvider>
            </div>
        );
    }
}

const mapStateToProps = (state: AppState) => ({
    program: state.core.plan?.program || null,
    programStatus: state.core.planProgramStatus,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({});

export default connect(mapStateToProps, mapDispatchToProps)(VizProgress);
