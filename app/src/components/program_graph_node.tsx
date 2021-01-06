import * as React from 'react';
import {
    Handle as ReactFlowHandle,
    Node as NodeData,
    Position
} from 'react-flow-renderer';
import { ActionStatusIndicator } from './status';
import { proto } from '@dashql/core';
import {
    IIconProps,
    AnalyticsIcon,
    DatabaseImportIcon,
    DatabaseSearchIcon,
    FileDocumentBoxPlusIcon,
    VariableBoxIcon,
} from '../svg/icons';

import styles from './program_graph.module.css';

function getStatementTypeLabel(type: proto.syntax.StatementType) {
    switch (type) {
        case proto.syntax.StatementType.CREATE_TABLE:
            return 'CREATE TABLE';
        case proto.syntax.StatementType.CREATE_VIEW:
            return 'CREATE VIEW';
        case proto.syntax.StatementType.EXTRACT_CSV:
            return 'EXTRACT CSV';
        case proto.syntax.StatementType.EXTRACT_JSON:
            return 'EXTRACT JSON';
        case proto.syntax.StatementType.LOAD_FILE:
            return 'LOAD FILE';
        case proto.syntax.StatementType.LOAD_HTTP:
            return 'LOAD HTTP';
        case proto.syntax.StatementType.PARAMETER:
            return 'PARAMETER';
        case proto.syntax.StatementType.SELECT:
            return 'SELECT';
        case proto.syntax.StatementType.SELECT_INTO:
            return 'SELECT INTO';
        case proto.syntax.StatementType.VIZUALIZE:
            return 'VISUALIZE';
        default:
            return '?';
    }
}

function StatementTypeIcon(props: IIconProps & { type: proto.syntax.StatementType }) {
    switch (props.type) {
        case proto.syntax.StatementType.CREATE_TABLE:
            return <DatabaseSearchIcon {...props} />;
        case proto.syntax.StatementType.CREATE_VIEW:
            return <DatabaseSearchIcon {...props} />;
        case proto.syntax.StatementType.EXTRACT_CSV:
            return <DatabaseImportIcon {...props} />;
        case proto.syntax.StatementType.EXTRACT_JSON:
            return <DatabaseImportIcon {...props} />;
        case proto.syntax.StatementType.LOAD_FILE:
            return <FileDocumentBoxPlusIcon {...props} />;
        case proto.syntax.StatementType.LOAD_HTTP:
            return <FileDocumentBoxPlusIcon {...props} />;
        case proto.syntax.StatementType.PARAMETER:
            return <VariableBoxIcon {...props} />;
        case proto.syntax.StatementType.SELECT:
            return <DatabaseSearchIcon {...props} />;
        case proto.syntax.StatementType.SELECT_INTO:
            return <DatabaseSearchIcon {...props} />;
        case proto.syntax.StatementType.VIZUALIZE:
            return <AnalyticsIcon {...props} />;
        default:
            return <div />;
    }
}

export interface StatementNodeData extends NodeData {
    statementId: number;
    data: {
        statementType: proto.syntax.StatementType;
        actionStatus: proto.action.ActionStatusCode | null;
    };
}

export function StatementNode(props: StatementNodeData) {
    const label = getStatementTypeLabel(props.data.statementType);
    return (
        <div className={styles.node}>
            <div className={styles.node_header}>
                <div className={styles.node_type}>
                    <StatementTypeIcon
                        className={styles.node_icon}
                        fill="rgb(80, 80, 80)"
                        width="22px"
                        height="22px"
                        type={props.data.statementType}
                    />
                    <ReactFlowHandle type="target" position={Position.Left} className={styles.node_handle_left} />
                    <ReactFlowHandle type="source" position={Position.Right} className={styles.node_handle_right} />
                </div>
            </div>
            <div className={styles.node_detail}>
                <div className={styles.node_detail_status}>
                    <ActionStatusIndicator
                        className={styles.node_detail_status_spinner}
                        fill="rgb(80, 80, 80)"
                        width="14px"
                        height="14px"
                        status={props.data.actionStatus}
                    />
                </div>
                <div className={styles.node_detail_label}>{label}</div>
            </div>
        </div>
    );
}
