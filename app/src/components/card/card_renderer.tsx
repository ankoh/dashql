import * as React from 'react';
import { TaskStatusCode } from '../../model/task_status';
import { useWorkflowSessionState } from '../../backend/workflow_session';
import { CardStatus } from './card_status';
import { TableCardRenderer } from './table_card_renderer';
import { VegaCardRenderer } from './vega_card_renderer';
import { InputTextRenderer } from '../input_text_renderer';

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
    const taskStatus = sessionState.statusByTask.get(taskId);
    const taskData = sessionState.dataById.get(task.data_id);
    if (taskStatus !== TaskStatusCode.Completed || taskData === undefined) {
        return <CardStatus statementId={props.statementId} />;
    }

    switch (taskData.t) {
        case 'InputData': {
            return <InputTextRenderer statementId={props.statementId} data={taskData.v} editable={props.editable} />;
        }
        case 'VizData': {
            const rendererData = taskData.v.renderer;
            switch (rendererData.t) {
                case 'Table':
                    return (
                        <TableCardRenderer
                            statementId={props.statementId}
                            data={rendererData}
                            editable={props.editable}
                        />
                    );
                case 'VegaLite':
                    return (
                        <VegaCardRenderer
                            statementId={props.statementId}
                            data={rendererData}
                            editable={props.editable}
                        />
                    );
                default:
                    return <div />;
            }
        }
    }
};
