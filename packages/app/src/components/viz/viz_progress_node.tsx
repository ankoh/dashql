import * as React from 'react';
import { Handle as ReactFlowHandle, Node as NodeData, Position } from 'react-flow-renderer';
import { ActionStatusIndicator } from '../status';
import { proto } from '@dashql/core';

import styles from './viz_progress.module.css';

export interface StatementNodeData extends NodeData {
    statementId: number;
    data: {
        statementType: proto.syntax.StatementType;
        actionStatus: proto.action.ActionStatusCode | null;
        focused: boolean;
    };
}

export function StatementNode(props: StatementNodeData) {
    const fill = props.data.focused ? 'rgb(80, 80, 80)' : 'rgba(80, 80, 80, 0.3)';
    return (
        <div className={styles.node}>
            <div className={styles.node_status}>
                <ActionStatusIndicator
                    className={styles.node_status_spinner}
                    fill={fill}
                    width="14px"
                    height="14px"
                    status={props.data.actionStatus}
                />
            </div>
            <ReactFlowHandle type="target" position={Position.Top} className={styles.node_handle_top} />
            <ReactFlowHandle type="source" position={Position.Bottom} className={styles.node_handle_bottom} />
        </div>
    );
}
