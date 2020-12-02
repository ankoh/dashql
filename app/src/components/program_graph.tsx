import * as React from "react";
import * as core from "@dashql/core";
import * as dagre from 'dagre';
import ReactFlow, { Controls, Handle as ReactFlowHandle } from 'react-flow-renderer';
import { ActionStatusSpinner } from './spinners';
import classNames from 'classnames';
import { FlowElement, Node as NodeData, Edge as EdgeData } from 'react-flow-renderer';
import { proto } from "@dashql/core";
import {
    IIconProps,
    AnalyticsIcon,
    DatabaseImportIcon,
    DatabaseSearchIcon,
    FileDocumentBoxPlusIcon,
    VariableBoxIcon,
} from '../svg/icons';

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

function StatementTypeIcon(props: IIconProps & { type: proto.syntax.StatementType }) {
    switch (props.type) {
        case proto.syntax.StatementType.CREATE_TABLE:
            return <DatabaseSearchIcon {...props} />
        case proto.syntax.StatementType.CREATE_VIEW:
            return <DatabaseSearchIcon {...props} />
        case proto.syntax.StatementType.EXTRACT_CSV:
            return <DatabaseImportIcon {...props} />
        case proto.syntax.StatementType.EXTRACT_JSON:
            return <DatabaseImportIcon {...props} />
        case proto.syntax.StatementType.LOAD_FILE:
            return <FileDocumentBoxPlusIcon {...props} />
        case proto.syntax.StatementType.LOAD_HTTP:
            return <FileDocumentBoxPlusIcon {...props} />
        case proto.syntax.StatementType.PARAMETER:
            return <VariableBoxIcon {...props} />
        case proto.syntax.StatementType.SELECT:
            return <DatabaseSearchIcon {...props} />
        case proto.syntax.StatementType.SELECT_INTO:
            return <DatabaseSearchIcon {...props} />
        case proto.syntax.StatementType.VIZUALIZE:
            return <AnalyticsIcon {...props} />
        default:
            return <div />;
    }
}

interface ProgramNodeData extends NodeData {
    data: {
        statementType: proto.syntax.StatementType;
        actionStatus: proto.action.ActionStatus | null;
    }
}

function Node(props: ProgramNodeData) {
    const label = getStatementTypeLabel(props.data.statementType);
    return (
        <div className={styles.node}>
            <div className={styles.node_header}>
                <div className={styles.node_type}>
                    <StatementTypeIcon className={styles.node_icon} fill="rgb(100, 100, 100)"  width="22px" height="22px" type={props.data.statementType} />
                    <ReactFlowHandle type="target" position="left" className={styles.node_handle_left} />
                    <ReactFlowHandle type="source" position="right" className={styles.node_handle_right} />
                </div>
            </div>
            <div className={styles.node_detail}>
                <div className={styles.node_detail_status}>
                    <ActionStatusSpinner className={styles.node_detail_status_spinner} fill="black" width="14px" height="14px" status={props.data.actionStatus} />
                </div>
                <div className={styles.node_detail_label}>{label}</div>
            </div>
        </div>
    );
}

interface ProgramGraphProps {
    program: core.parser.Program | null;
    className?: string
}

class ProgramGraph extends React.Component<ProgramGraphProps> {
    public render() {
        if (this.props.program == null) {
            return <div />;
        }

        const FIT_PADDING = 0.2;
        const NODE_WIDTH = 120;
        const NODE_HEIGHT = 80;
        const NODE_SIZE = {
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
        };

        // We use dagre to do the layouting and the render the graph with react-flow
        let nodes: ProgramNodeData[] = [];
        let edges: EdgeData[] = [];
        const g = new dagre.graphlib.Graph().setGraph({
            nodesep: 60,
            ranksep: 40,
            rankdir: 'LR'
        });
        this.props.program.iterateStatements((idx: number, stmt: core.parser.Statement) => {
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
                    actionStatus: null
                }
            });
        });
        this.props.program.iterateDependencies((idx: number, dep: sx.Dependency) => {
            g.setEdge(dep.sourceStatement().toString(), dep.targetStatement().toString(), {});
            edges.push({
                id: "e-" + idx.toString(),
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
                }
            }
        });
        let elements = (nodes as FlowElement[]).concat(edges as FlowElement[]);

        return (
            <div className={classNames(this.props.className)}>
                <ReactFlow
                    elements={elements}
                    defaultPosition={[20, 20]}
                    nodesDraggable={false}
                    onLoad={(flow) => flow.fitView({padding: FIT_PADDING})}
                    nodeTypes={{
                        custom: Node,
                    }}
                    nodesConnectable={false}
                >
                    <Controls />
                </ReactFlow>
            </div>
        );
    }
}

export default ProgramGraph;
