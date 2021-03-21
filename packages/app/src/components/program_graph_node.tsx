import * as React from 'react';
import { Handle as ReactFlowHandle, Node as NodeData, Position } from 'react-flow-renderer';
import { ActionStatusIndicator } from './status';
import { proto } from '@dashql/core';

import icon_analytics from '../../static/svg/icons/analytics.svg';
import icon_database_import from '../../static/svg/icons/database_import.svg';
import icon_database_search from '../../static/svg/icons/database_search.svg';
import icon_file_document_plus from '../../static/svg/icons/file_document_plus.svg';
import icon_variable_box from '../../static/svg/icons/variable_box.svg';

import styles from './program_graph.module.css';

function StatementTypeIcon(type: proto.syntax.StatementType): string {
    switch (type) {
        case proto.syntax.StatementType.CREATE_TABLE:
        case proto.syntax.StatementType.CREATE_TABLE_AS:
        case proto.syntax.StatementType.CREATE_VIEW:
        case proto.syntax.StatementType.SELECT:
        case proto.syntax.StatementType.SELECT_INTO:
            return icon_database_search;
        case proto.syntax.StatementType.EXTRACT_CSV:
        case proto.syntax.StatementType.EXTRACT_JSON:
            return icon_database_import;
        case proto.syntax.StatementType.LOAD_FILE:
        case proto.syntax.StatementType.LOAD_HTTP:
            return icon_file_document_plus;
        case proto.syntax.StatementType.PARAMETER:
            return icon_variable_box;
        case proto.syntax.StatementType.VIZUALIZE:
            return icon_analytics;
        default:
            return icon_analytics;
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
    return (
        <div className={styles.node}>
            <div className={styles.node_type}>
                <svg width="22px" height="22px" style={{ fill: 'rgb(80, 80, 80)' }}>
                    <use xlinkHref={`${StatementTypeIcon(props.data.statementType)}#sym`} />
                </svg>
                <ReactFlowHandle type="target" position={Position.Top} className={styles.node_handle_top} />
                <ReactFlowHandle type="source" position={Position.Bottom} className={styles.node_handle_bottom} />
            </div>
            <div className={styles.node_status}>
                <ActionStatusIndicator
                    className={styles.node_status_spinner}
                    fill="rgb(80, 80, 80)"
                    width="14px"
                    height="14px"
                    status={props.data.actionStatus}
                />
            </div>
        </div>
    );
}
