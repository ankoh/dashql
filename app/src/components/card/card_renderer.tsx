import * as React from 'react';
import { useWorkflowSessionState } from '../../backend/workflow_session';
import { CardStatus } from './card_status';
import { TableCardRenderer } from './table_card_renderer';

interface Props {
    statementId: number;
    editable?: boolean;
}

export const CardRenderer: React.FunctionComponent<Props> = (props: Props) => {
    const sessionState = useWorkflowSessionState();

    // Resolve task for statement
    const task_by_stmt = sessionState.programTasks?.task_by_statement;
    if (task_by_stmt == null || props.statementId >= task_by_stmt.length) {
        return <CardStatus statementId={props.statementId} />;
    }

    // Task id valid?
    const taskId = task_by_stmt[props.statementId];
    if (taskId >= sessionState.programTasks.tasks.length) {
        return <CardStatus statementId={props.statementId} />;
    }

    // Resolve task data
    const task = sessionState.programTasks.tasks[taskId];
    const data = sessionState.dataById.get(task.data_id);
    if (data === undefined || data.t != 'VizData') {
        return <CardStatus statementId={props.statementId} />;
    }

    const rendererData = data.v.renderer;
    switch (rendererData.t) {
        case 'Table':
            return (
                <div style={{ width: '100%', height: '100%' }}>
                    <TableCardRenderer data={rendererData} />
                </div>
            );
        case 'VegaLite':
            return <div>Vega Lite</div>;
        default:
            return <div />;
    }
};
